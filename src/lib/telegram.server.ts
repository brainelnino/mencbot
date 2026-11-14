// Server-only Telegram service. Never import from browser code.
import { classifyUpdate, findBlockedTerm, hasLink, hasPhone, normalizeEntities, type TgEntity, type TgUpdate } from "./telegram-parse";
import { contentRejection, parsePolicy } from "./content-policy";
import { t } from "./i18n";
import { buildMessageHtml, entitiesToHtml, escapeHtml, telegramMessagePayload, telegramStoredMessageText, voteKeyboard, withReactionFooter } from "./telegram-format";
import { parseVotePolicy, votesEnabled } from "./vote-policy";

const GATEWAY_URL = "https://connector-gateway.lovable.dev/telegram";

export class TelegramError extends Error {
  constructor(message: string, public status: number, public retryable: boolean) { super(message); }
}

function log(level: "info" | "warn" | "error", event: string, data: Record<string, unknown> = {}) {
  console[level](JSON.stringify({ src: "telegram", event, ...data }));
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/** Hupanga mwanzo wa maombi ili yasizidi `perSecond` kwa sekunde (kikomo cha Telegram ni ~30). */
function rateGate(perSecond: number) {
  const gap = 1000 / perSecond;
  let next = Date.now();
  return async () => {
    const now = Date.now();
    const at = Math.max(now, next);
    next = at + gap;
    if (at > now) await sleep(at - now);
  };
}

/** Calls the Telegram Bot API through the gateway with a timeout and one retry on temporary failures. */
export async function tg<T = unknown>(method: string, body: Record<string, unknown> = {}, timeoutMs = 8000): Promise<T> {
  const lovableKey = process.env["LOVABLE_API_KEY"];
  const tgKey = process.env["TELEGRAM_API_KEY"];
  if (!lovableKey || !tgKey) throw new TelegramError("Telegram haijasanidiwa kwenye seva", 500, false);
  let last: TelegramError | null = null;
  for (let attempt = 0; attempt < 2; attempt++) {
    let wait = 600;
    try {
      const res = await fetch(`${GATEWAY_URL}/${method}`, {
        method: "POST",
        headers: { Authorization: `Bearer ${lovableKey}`, "X-Connection-Api-Key": tgKey, "Content-Type": "application/json" },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(timeoutMs),
      });
      const text = await res.text();
      let json: { ok?: boolean; result?: T; description?: string; parameters?: { retry_after?: number } } = {};
      try { json = JSON.parse(text); } catch { /* non-JSON */ }
      if (res.ok && json.ok) return json.result as T;
      const retryable = res.status === 429 || res.status >= 500;
      last = new TelegramError(`${method} [${res.status}]: ${json.description ?? text.slice(0, 300)}`, res.status, retryable);
      if (!retryable) break;
      // Telegram inasema ni muda gani wa kusubiri ikizuia kasi (429).
      if (res.status === 429 && json.parameters?.retry_after) wait = Math.min(json.parameters.retry_after * 1000, 3000);
    } catch (e) {
      last = new TelegramError(`${method}: ${e instanceof Error ? e.message : String(e)}`, 0, true);
    }
    log("warn", "api_retry", { method, attempt, error: last?.message });
    if (attempt === 1) break;
    await sleep(wait);
  }
  throw last ?? new TelegramError("Telegram request failed", 0, true);
}

async function admin() {
  return (await import("@/integrations/supabase/client.server")).supabaseAdmin;
}

async function recordConfig(patch: Record<string, unknown>) {
  const db = await admin();
  const { data } = await db.from("telegram_config").select("id").limit(1).maybeSingle();
  if (data) await db.from("telegram_config").update({ ...patch, updated_at: new Date().toISOString() }).eq("id", data.id);
}

async function brandName() {
  const { data } = await (await admin()).rpc("get_brand_name");
  return data || "Live Chat bot";
}

async function votePolicy() {
  const { data, error } = await (await admin()).from("system_settings").select("value").eq("key", "vote_policy").maybeSingle();
  if (error) throw error;
  return parseVotePolicy(data?.value);
}

const POLL_EMOJIS = ["1️⃣", "2️⃣", "3️⃣", "4️⃣"] as const;

function pollOf(v: unknown): { options: string[]; closed: boolean } | null {
  const p = (v as { poll?: { options?: unknown; closed?: unknown } } | null)?.poll;
  return p && Array.isArray(p.options) && p.options.length >= 2 ? { options: p.options.map(String), closed: p.closed === true } : null;
}

function pollKeyboard(count: number, summary: Array<{ emoji: string; total: number | bigint }> = []) {
  return {
    inline_keyboard: [POLL_EMOJIS.slice(0, count).map((e, i) => {
      const n = Number(summary.find((s) => s.emoji === e)?.total ?? 0);
      return { text: n ? `${e} ${n}` : e, callback_data: `p:${i}` };
    })],
  };
}

/** Processes one verified update idempotently. */
export async function handleUpdate(update: TgUpdate) {
  const db = await admin();
  const c = classifyUpdate(update);

  // Idempotency: claim the update_id. Duplicate deliveries of processed updates are skipped.
  // Aina mpya zinahifadhiwa kama "private_other" ili safu ya update_kind isikatae thamani mpya.
  const kindForDb = c.kind === "history" || c.kind === "search" || c.kind === "admin_pin" || c.kind === "admin_poll" || c.kind === "admin_diag" || c.kind === "poll_vote" ? "private_other" : c.kind;
  const { error: insErr } = await db.from("telegram_updates").insert({ update_id: update.update_id, update_kind: kindForDb });
  if (insErr) {
    if (insErr.code !== "23505") throw insErr;
    const { data: prev } = await db.from("telegram_updates").select("status,attempts").eq("update_id", update.update_id).single();
    if (prev?.status === "processed" || prev?.status === "ignored") { log("info", "duplicate_skipped", { update_id: update.update_id }); return; }
    await db.from("telegram_updates").update({ status: "received", attempts: (prev?.attempts ?? 1) + 1 }).eq("update_id", update.update_id);
  }

  try {
    let status: "processed" | "ignored" = "processed";
    switch (c.kind) {
      case "start": {
        const { data, error } = await db.rpc("register_telegram_member", { _tg_user_id: c.userId });
        if (error) {
          if (error.message.includes("IDENTITY_RANGES_EXHAUSTED")) {
            await tg("sendMessage", { chat_id: c.chatId, text: "Samahani, nafasi za usajili zimejaa kwa sasa. Tafadhali jaribu tena baadaye." });
            log("error", "identity_exhausted");
            break;
          }
          throw error;
        }
        const row = data?.[0];
        if (!row) throw new Error("Usajili haukurudisha utambulisho");
        // Mtu aliyezuia bot kisha akarudi kwa /start anaanza kupokea ujumbe tena.
        await db.from("members").update({ last_active_at: new Date().toISOString() }).eq("telegram_user_id", c.userId);
        await tg("sendMessage", { chat_id: c.chatId, text: row.is_new ? `Karibu ${await brandName()} 🇹🇿\n${row.label}` : t.telegram.welcomeBack(row.label) });
        if (row.is_new) await tg("sendMessage", { chat_id: c.chatId, text: "📜 Unataka kuona mazungumzo ya masaa 24 yaliyopita? Unaweza pia kuandika /historia wakati wowote.", reply_markup: { inline_keyboard: [[{ text: "📜 Ona ya masaa 24", callback_data: "h:24" }]] } });
        log("info", "registered", { is_new: row.is_new });
        break;
      }
      case "history": {
        if (c.callbackId) await tg("answerCallbackQuery", { callback_query_id: c.callbackId }).catch(() => {});
        const { data: mem } = await db.from("members").select("id,status").eq("telegram_user_id", c.userId).maybeSingle();
        if (!mem) { await tg("sendMessage", { chat_id: c.chatId, text: "Tuma /start kwanza ili kujisajili." }); break; }
        if (mem.status !== "active") { status = "ignored"; break; }
        if (c.messageId) await tg("editMessageReplyMarkup", { chat_id: c.chatId, message_id: c.messageId, reply_markup: { inline_keyboard: [] } }).catch(() => {});
        await sendHistory(c.chatId, c.userId);
        break;
      }
      case "search": {
        const { data: mem } = await db.from("members").select("id,status").eq("telegram_user_id", c.userId).maybeSingle();
        if (!mem) { await tg("sendMessage", { chat_id: c.chatId, text: "Tuma /start kwanza ili kujisajili." }); break; }
        if (mem.status !== "active") { status = "ignored"; break; }
        await searchMessages(c.chatId, c.userId, c.query);
        break;
      }
      case "admin_diag": {
        const { data: slot, error: slotError } = await db.rpc("get_telegram_admin_slot", { _tg_user_id: c.userId });
        if (slotError) throw slotError;
        if (!slot) { await tg("sendMessage", { chat_id: c.chatId, text: t.telegram.noPermission }); break; }
        await sendDiagnostics(c.chatId);
        break;
      }
      case "admin_pin": {
        const { data: slot, error: slotError } = await db.rpc("get_telegram_admin_slot", { _tg_user_id: c.userId });
        if (slotError) throw slotError;
        if (!slot) { await tg("sendMessage", { chat_id: c.chatId, text: t.telegram.noPermission }); break; }
        const { data: mem } = await db.from("members").select("id").eq("telegram_user_id", c.userId).maybeSingle();
        if (!mem || c.replyMessageId === null) {
          await tg("sendMessage", { chat_id: c.chatId, text: "📌 Jibu ujumbe unaotaka kubandika kwa wote kisha andika /pin. Kuuondoa, jibu ujumbe huo na uandike /unpin." });
          break;
        }
        const { data: target, error: replyError } = await db.rpc("resolve_telegram_reply", { _member_id: mem.id, _telegram_message_id: c.replyMessageId });
        if (replyError) throw replyError;
        if (!target) { await tg("sendMessage", { chat_id: c.chatId, text: "⚠️ Ujumbe huo haujapatikana. Jibu ujumbe wa kwenye chat." }); break; }
        const res = await pinEverywhere(target, c.action);
        await tg("sendMessage", { chat_id: c.chatId, text: c.action === "pin" ? `📌 Imebandikwa kwa chat ${res.done} kati ya ${res.total}.` : `📍 Imeondolewa kwa chat ${res.done} kati ya ${res.total}.` });
        break;
      }
      case "admin_poll": {
        const { data: slot, error: slotError } = await db.rpc("get_telegram_admin_slot", { _tg_user_id: c.userId });
        if (slotError) throw slotError;
        if (!slot) { await tg("sendMessage", { chat_id: c.chatId, text: t.telegram.noPermission }); break; }
        const { data: mem } = await db.from("members").select("id").eq("telegram_user_id", c.userId).maybeSingle();
        if (c.action === "close") {
          let targetId: string | null = null;
          if (c.replyMessageId !== null && mem) {
            const { data: resolved, error: resolveError } = await db.rpc("resolve_telegram_reply", { _member_id: mem.id, _telegram_message_id: c.replyMessageId });
            if (resolveError) throw resolveError;
            targetId = resolved;
          }
          if (!targetId) {
            const { data: recent, error: recentError } = await db.from("messages").select("id, telegram_chat_message_ref").eq("processing_status", "published").order("created_at", { ascending: false }).limit(100);
            if (recentError) throw recentError;
            targetId = recent?.find((m) => { const p = pollOf(m.telegram_chat_message_ref); return !!p && !p.closed; })?.id ?? null;
          }
          if (!targetId) { await tg("sendMessage", { chat_id: c.chatId, text: "Hakuna poll iliyo wazi. Jibu poll unayotaka kufunga kisha andika /pollfunga." }); break; }
          const { data: row, error: rowError } = await db.from("messages").select("telegram_chat_message_ref").eq("id", targetId).single();
          if (rowError) throw rowError;
          const poll = pollOf(row.telegram_chat_message_ref);
          if (!poll) { await tg("sendMessage", { chat_id: c.chatId, text: "Ujumbe huo si poll." }); break; }
          if (poll.closed) { await tg("sendMessage", { chat_id: c.chatId, text: "Poll hiyo tayari imefungwa." }); break; }
          const { error: closeError } = await db.from("messages").update({ telegram_chat_message_ref: { ...(row.telegram_chat_message_ref as Record<string, unknown>), poll: { ...poll, closed: true } } as never }).eq("id", targetId);
          if (closeError) throw closeError;
          await syncReactionEdits(targetId);
          await tg("sendMessage", { chat_id: c.chatId, text: "🔒 Poll imefungwa na matokeo yametumwa kwa wote." });
          break;
        }
        const parts = c.raw.split("|").map((s) => s.trim()).filter(Boolean);
        if (parts.length < 3 || parts.length > 5 || parts.some((s, i) => s.length > (i === 0 ? 200 : 60))) {
          await tg("sendMessage", { chat_id: c.chatId, parse_mode: "HTML", text: "📊 Andika: <code>/poll Swali | Chaguo 1 | Chaguo 2 | Chaguo 3</code>\nChaguo ni 2 hadi 4 (kila moja hadi herufi 60). Kuifunga andika <code>/pollfunga</code>." });
          break;
        }
        const [question, ...options] = parts as [string, ...string[]];
        const body = `📊 ${question}\n\n${options.map((o, i) => `${POLL_EMOJIS[i]} ${o}`).join("\n")}`;
        const pollRow = (member_id: string) => ({
          member_id, sender_label: "📊 Poll", kind: "text" as const, body, reply_to_id: null,
          telegram_chat_message_ref: { poll: { options, closed: false } },
          source_update_id: update.update_id, moderation_status: "pending" as const,
          publication_status: "unpublished" as const, processing_status: "awaiting_moderation" as const,
        });
        const upsertOpts = { onConflict: "source_update_id", ignoreDuplicates: true };
        let ins = await db.from("messages").upsert(pollRow(null as unknown as string), upsertOpts);
        if (ins.error && mem) ins = await db.from("messages").upsert(pollRow(mem.id), upsertOpts);
        if (ins.error) throw ins.error;
        const { data: pollMsg, error: pollErr } = await db.from("messages").select("id").eq("source_update_id", update.update_id).single();
        if (pollErr) throw pollErr;
        await publishMessage(pollMsg.id);
        await tg("sendMessage", { chat_id: c.chatId, text: "📊 Poll imetumwa kwa wanachama. Kuifunga andika /pollfunga." });
        break;
      }
      case "poll_vote": {
        const answer = (text = "") => tg("answerCallbackQuery", { callback_query_id: c.callbackId, ...(text ? { text } : {}) }).catch(() => {});
        const { data: mem } = await db.from("members").select("id,status").eq("telegram_user_id", c.userId).maybeSingle();
        if (!mem || mem.status !== "active") { await answer("Tuma /start kwanza."); status = "ignored"; break; }
        const { data: target } = await db.from("telegram_deliveries").select("message_id").eq("member_id", mem.id).eq("telegram_message_id", c.messageId).eq("status", "sent").maybeSingle();
        if (!target) { await answer("Poll haipatikani."); status = "ignored"; break; }
        const { data: message, error: messageError } = await db.from("messages").select("telegram_chat_message_ref").eq("id", target.message_id).single();
        if (messageError) throw messageError;
        const poll = pollOf(message.telegram_chat_message_ref);
        if (!poll || c.option >= poll.options.length) { await answer("Chaguo hili halipo."); status = "ignored"; break; }
        if (poll.closed) { await answer("🔒 Kura zimefungwa."); status = "ignored"; break; }
        const emoji = POLL_EMOJIS[c.option]!;
        const { data: cur } = await db.from("message_reactions").select("emoji").eq("message_id", target.message_id).eq("member_id", mem.id).maybeSingle();
        const next = cur?.emoji === emoji ? "" : emoji;
        const { data: pollMessageId, error: voteError } = await db.rpc("record_telegram_reaction", { _tg_user_id: c.userId, _telegram_message_id: c.messageId, _emoji: next });
        if (voteError || !pollMessageId) {
          log("error", "poll_vote_failed", { error: voteError ? voteError.message : "no message" });
          await answer("⚠️ Kura haijahifadhiwa.");
          status = "ignored";
          break;
        }
        await answer(next ? `${next} Umepiga kura` : "Kura imeondolewa");
        await syncReactionEdits(pollMessageId);
        break;
      }
      case "private_text":
      case "private_media": {
        const media = c.kind === "private_media" ? c.media : null;
        const { data: mem } = await db.from("members").select("id,status,can_send_restricted,public_identities(label)").eq("telegram_user_id", c.userId).maybeSingle();
        const label = (mem?.public_identities as { label: string } | null)?.label;
        if (!mem || !label) {
          await tg("sendMessage", { chat_id: c.chatId, text: "Tuma /start kwanza ili kujisajili." });
          break;
        }
        if (mem.status !== "active") { status = "ignored"; break; }
        const [{ data: policyRow }, { data: termRows, error: termError }] = await Promise.all([
          db.from("system_settings").select("value").eq("key", "content_policy").maybeSingle(),
          db.from("blocked_terms").select("term"),
        ]);
        const rejection = contentRejection(parsePolicy(policyRow?.value), mem.can_send_restricted, media, hasLink(c.text), hasPhone(c.text));
        if (rejection) {
          await tg("sendMessage", { chat_id: c.chatId, text: rejection === "media" ? "⚠️ Ujumbe haujatumwa: aina hii ya faili/picha hairuhusiwi kwa sasa." : "⚠️ Ujumbe haujatumwa: link na namba za simu haziruhusiwi." });
          status = "ignored"; break;
        }
        if (termError) throw termError;
        if (findBlockedTerm(c.text, (termRows ?? []).map((r) => r.term))) {
          await tg("sendMessage", { chat_id: c.chatId, text: t.telegram.blockedTerm });
          status = "ignored"; break;
        }
        // Sheria: ujumbe uliotumwa kwa Reply ni wa siri (kwa mwenye ujumbe aliyejibiwa pekee); bila Reply ni wa wazi.
        const route: ReplyRoute = c.replyMessageId !== null ? await resolveReplyRoute(mem.id, c.chatId, c.replyMessageId) : { kind: "public" };
        if (route.kind === "unknown") {
          await tg("sendMessage", {
            chat_id: c.chatId,
            text: "⚠️ Jibu halijatumwa: sikuweza kutambua ujumbe uliojibu. Tuma bila Reply ili iwe ya wazi kwa wote.",
            reply_parameters: { message_id: c.messageId, allow_sending_without_reply: true },
          });
          status = "ignored"; break;
        }
        const touch = () => Promise.all([
          db.from("members").update({ last_active_at: new Date().toISOString() }).eq("id", mem.id),
          db.from("activity_events").insert({ member_id: mem.id, event_type: "message_received" }),
        ]);
        if (route.kind === "private") {
          await sendPrivateReply({
            updateId: update.update_id, memberId: mem.id, senderLabel: label, chatId: c.chatId, messageId: c.messageId,
            media, text: c.text, entities: c.entities, to: route,
          });
          await touch();
          break;
        }
        const { error } = await db.from("messages").upsert({
          member_id: mem.id, sender_label: label, kind: media === "photo" ? "image" : "text", body: c.text || null,
          reply_to_id: null, telegram_chat_message_ref: { message_id: c.messageId, chat_id: c.chatId, media, entities: c.entities },
          source_update_id: update.update_id, moderation_status: "pending",
          publication_status: "unpublished", processing_status: "awaiting_moderation",
        }, { onConflict: "source_update_id", ignoreDuplicates: true });
        if (error) throw error;
        // Kazi za kumbukumbu zinaendeshwa sambamba na utumaji ili zisichelewesha ujumbe.
        const bookkeeping = touch();
        const { data: msg, error: msgError } = await db.from("messages").select("id").eq("source_update_id", update.update_id).single();
        if (msgError) throw msgError;
        await publishMessage(msg.id);
        await bookkeeping;
        break;
      }
      case "admin_command": {
        const { data: slot, error: slotError } = await db.rpc("get_telegram_admin_slot", { _tg_user_id: c.userId });
        if (slotError) throw slotError;
        if (!slot) { await tg("sendMessage", { chat_id: c.chatId, text: t.telegram.noPermission }); break; }
        if (c.command === "admin" || !c.label) { await tg("sendMessage", { chat_id: c.chatId, text: t.telegram.adminMenu(slot) }); break; }
        const { error } = await db.rpc("telegram_admin_set_member_status", { _tg_user_id: c.userId, _label: c.label, _status: c.command === "zuia" ? "banned" : "active" });
        await tg("sendMessage", { chat_id: c.chatId, text: error?.message ?? t.telegram.adminDone });
        break;
      }
      case "reaction": {
        const { data: reactionMessageId, error } = await db.rpc("record_telegram_reaction", { _tg_user_id: c.userId, _telegram_message_id: c.messageId, _emoji: c.emoji ?? "" });
        if (error) throw error;
        if (!reactionMessageId) { status = "ignored"; break; }
        await syncReactionEdits(reactionMessageId);
        break;
      }
      case "vote": {
        // Pressing the same button again removes the vote; votes stay anonymous.
        const { data: mem } = await db.from("members").select("id").eq("telegram_user_id", c.userId).maybeSingle();
        let emoji = c.emoji;
        if (mem) {
          const { data: target } = await db.from("telegram_deliveries").select("message_id").eq("member_id", mem.id).eq("telegram_message_id", c.messageId).eq("status", "sent").maybeSingle();
          if (target) {
            const { data: message, error: messageError } = await db.from("messages").select("telegram_chat_message_ref").eq("id", target.message_id).single();
            if (messageError) throw messageError;
            if (!votesEnabled(await votePolicy(), mediaRef(message.telegram_chat_message_ref)?.media)) {
              await tg("answerCallbackQuery", { callback_query_id: c.callbackId, text: t.voteControls.disabled }).catch(() => {});
              await tg("editMessageReplyMarkup", { chat_id: c.chatId, message_id: c.messageId, reply_markup: { inline_keyboard: [] } }).catch(() => {});
              status = "ignored";
              break;
            }
            const { data: cur } = await db.from("message_reactions").select("emoji").eq("message_id", target.message_id).eq("member_id", mem.id).maybeSingle();
            if (cur?.emoji === c.emoji) emoji = "";
          }
        }
        const { data: voteMessageId, error } = await db.rpc("record_telegram_reaction", { _tg_user_id: c.userId, _telegram_message_id: c.messageId, _emoji: emoji });
        await tg("answerCallbackQuery", { callback_query_id: c.callbackId, text: error || !voteMessageId ? "" : emoji ? `${emoji} Umepiga kura` : "Kura imeondolewa" }).catch(() => {});
        if (error) throw error;
        if (!voteMessageId) { status = "ignored"; break; }
        await syncReactionEdits(voteMessageId);
        break;
      }
      case "private_other":
        await tg("sendMessage", { chat_id: c.chatId, text: "Aina hii ya ujumbe haitumiki kwa sasa." });
        break;
      case "group_link": {
        const { data: cfg } = await db.from("telegram_config").select("id,group_link_code,group_link_expires_at").limit(1).maybeSingle();
        const valid = cfg?.group_link_code && cfg.group_link_code === c.code && cfg.group_link_expires_at && new Date(cfg.group_link_expires_at) > new Date();
        if (!valid || !cfg) { status = "ignored"; break; }
        const sent = await tg<{ message_id: number }>("sendMessage", { chat_id: c.chatId, text: "✅ Kikundi hiki kimeunganishwa na Live Chat bot. Ujumbe ulioidhinishwa utachapishwa hapa." });
        await db.from("telegram_config").update({
          public_group_chat_id: c.chatId, group_title: c.title, group_verified_at: new Date().toISOString(),
          group_link_code: null, group_link_expires_at: null,
        }).eq("id", cfg.id);
        await db.from("audit_events").insert({ action: "telegram.group_linked", target_type: "telegram_group", details: { title: c.title, test_message_id: sent.message_id } });
        break;
      }
      default:
        status = "ignored";
    }
    await db.from("telegram_updates").update({ status, processed_at: new Date().toISOString(), error: null }).eq("update_id", update.update_id);
    await recordConfig({ last_update_at: new Date().toISOString() });
  } catch (e) {
    const msg = e instanceof Error ? e.message : JSON.stringify(e);
    log("error", "update_failed", { update_id: update.update_id, error: msg });
    await db.from("telegram_updates").update({ status: "failed", error: msg.slice(0, 1000) }).eq("update_id", update.update_id);
    await recordConfig({ last_error: msg.slice(0, 500), last_error_at: new Date().toISOString() });
    throw e;
  }
}

/**
 * Husubiri hadi sekunde 6 ujumbe wa awali (update_id ndogo, ndani ya 20 zilizopita) ukamilike,
 * ili ujumbe usivuke mpangilio. Ni jaribio bora zaidi, si hakikisho kamili.
 */
async function waitForEarlier(updateId: number | null) {
  if (!updateId) return;
  const db = await admin();
  const deadline = Date.now() + 6000;
  while (Date.now() < deadline) {
    const { data } = await db.from("telegram_updates").select("update_id")
      .in("update_kind", ["private_text", "private_media"]).eq("status", "received")
      .lt("update_id", updateId).gte("update_id", updateId - 20).limit(1);
    if (!data?.length) return;
    await sleep(400);
  }
}

/**
 * Chat ambazo zimekosa kupokea ujumbe 3 mfululizo (bot imezuiwa) na mwenyewe hajaandika au kubonyeza /start tangu hapo.
 * Hizi zinarukwa ili zisipoteze muda; zikirudi kwa kuandika zinaanza kupokea tena.
 */
async function likelyBlockedChats(currentMessageId: string): Promise<Set<number>> {
  try {
    const db = await admin();
    const { data: recent } = await db.from("messages").select("id, created_at").eq("processing_status", "published").neq("id", currentMessageId)
      .filter("telegram_chat_message_ref->>private", "is", null)
      .order("created_at", { ascending: false }).limit(3);
    if (!recent || recent.length < 3) return new Set();
    const lists = await Promise.all(recent.map((m) => db.from("telegram_deliveries").select("member_id").eq("message_id", m.id).eq("status", "unreachable").limit(1000)));
    let ids: Set<string> | null = null;
    for (const l of lists) {
      const cur = new Set((l.data ?? []).map((d) => String(d.member_id)));
      ids = ids ? new Set([...ids].filter((x) => cur.has(x))) : cur;
    }
    if (!ids || !ids.size) return new Set();
    const oldest = new Date(recent[2]!.created_at).getTime();
    const all = [...ids];
    const out = new Set<number>();
    const parts: string[][] = [];
    for (let i = 0; i < all.length; i += 80) parts.push(all.slice(i, i + 80));
    const results = await Promise.all(parts.map((p) => db.from("members").select("telegram_user_id, last_active_at").in("id", p)));
    for (const r of results) {
      for (const m of r.data ?? []) {
        const active = m.last_active_at ? new Date(m.last_active_at).getTime() : 0;
        if (!(active > oldest)) out.add(m.telegram_user_id);
      }
    }
    return out;
  } catch (e) {
    log("warn", "blocked_lookup_failed", { error: e instanceof Error ? e.message : JSON.stringify(e) });
    return new Set();
  }
}

/**
 * Direct private broadcast. Sent recipients are never deliberately resent.
 * Telegram retries the webhook if transient failures or pending recipients remain.
 */
export async function publishMessage(messageId: string) {
  const db = await admin();
  const { error } = await db.rpc("enqueue_private_message", { _message_id: messageId });
  if (error) throw error;
  const { data: src, error: srcErr } = await db.from("messages").select("telegram_chat_message_ref, body, reply_to_id, source_update_id").eq("id", messageId).single();
  if (srcErr) throw srcErr;
  const ref = mediaRef(src.telegram_chat_message_ref);
  const entities = entitiesOf(src.telegram_chat_message_ref);
  const poll = pollOf(src.telegram_chat_message_ref);
  const [policy, notice, blocked] = await Promise.all([votePolicy(), noticeFor(src), likelyBlockedChats(messageId), waitForEarlier(src.source_update_id)]);
  const markup = poll
    ? { reply_markup: pollKeyboard(poll.options.length) }
    : votesEnabled(policy, ref?.media) ? { reply_markup: voteKeyboard() } : {};

  const claim = () => db.rpc("claim_private_deliveries_v2", { _message_id: messageId });
  type Claimed = NonNullable<Awaited<ReturnType<typeof claim>>["data"]>[number];
  const gate = rateGate(28);
  let temporaryFailure = false;

  const sendRow = async (row: Claimed) => {
    let patch: