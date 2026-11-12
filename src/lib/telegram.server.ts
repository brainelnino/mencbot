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

/** Calls the Telegram Bot API through the gateway with a timeout and one retry on temporary failures. */
export async function tg<T = unknown>(method: string, body: Record<string, unknown> = {}, timeoutMs = 8000): Promise<T> {
  const lovableKey = process.env["LOVABLE_API_KEY"];
  const tgKey = process.env["TELEGRAM_API_KEY"];
  if (!lovableKey || !tgKey) throw new TelegramError("Telegram haijasanidiwa kwenye seva", 500, false);
  let last: TelegramError | null = null;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const res = await fetch(`${GATEWAY_URL}/${method}`, {
        method: "POST",
        headers: { Authorization: `Bearer ${lovableKey}`, "X-Connection-Api-Key": tgKey, "Content-Type": "application/json" },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(timeoutMs),
      });
      const text = await res.text();
      let json: { ok?: boolean; result?: T; description?: string } = {};
      try { json = JSON.parse(text); } catch { /* non-JSON */ }
      if (res.ok && json.ok) return json.result as T;
      const retryable = res.status === 429 || res.status >= 500;
      last = new TelegramError(`${method} [${res.status}]: ${json.description ?? text.slice(0, 300)}`, res.status, retryable);
      if (!retryable) break;
    } catch (e) {
      last = new TelegramError(`${method}: ${e instanceof Error ? e.message : String(e)}`, 0, true);
    }
    log("warn", "api_retry", { method, attempt, error: last?.message });
    await new Promise((r) => setTimeout(r, 600));
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

/** Processes one verified update idempotently. */
export async function handleUpdate(update: TgUpdate) {
  const db = await admin();
  const c = classifyUpdate(update);

  // Idempotency: claim the update_id. Duplicate deliveries of processed updates are skipped.
  // "history" and "search" are stored as "private_other" so the existing update_kind column never rejects a new value.
  const { error: insErr } = await db.from("telegram_updates").insert({ update_id: update.update_id, update_kind: c.kind === "history" || c.kind === "search" ? "private_other" : c.kind });
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
        const { data: policyRow } = await db.from("system_settings").select("value").eq("key", "content_policy").maybeSingle();
        const rejection = contentRejection(parsePolicy(policyRow?.value), mem.can_send_restricted, media, hasLink(c.text), hasPhone(c.text));
        if (rejection) {
          await tg("sendMessage", { chat_id: c.chatId, text: rejection === "media" ? "⚠️ Ujumbe haujatumwa: aina hii ya faili/picha hairuhusiwi kwa sasa." : "⚠️ Ujumbe haujatumwa: link na namba za simu haziruhusiwi." });
          status = "ignored"; break;
        }
        const { data: termRows, error: termError } = await db.from("blocked_terms").select("term");
        if (termError) throw termError;
        if (findBlockedTerm(c.text, (termRows ?? []).map((r) => r.term))) {
          await tg("sendMessage", { chat_id: c.chatId, text: t.telegram.blockedTerm });
          status = "ignored"; break;
        }
        let replyToId: string | null = null;
        if (c.replyMessageId !== null) {
          const { data: parent, error: replyError } = await db.rpc("resolve_telegram_reply", { _member_id: mem.id, _telegram_message_id: c.replyMessageId });
          if (replyError) throw replyError;
          replyToId = parent;
        }
        const { error } = await db.from("messages").upsert({
          member_id: mem.id, sender_label: label, kind: media === "photo" ? "image" : "text", body: c.text || null,
          reply_to_id: replyToId, telegram_chat_message_ref: { message_id: c.messageId, chat_id: c.chatId, media, entities: c.entities },
          source_update_id: update.update_id, moderation_status: "pending",
          publication_status: "unpublished", processing_status: "awaiting_moderation",
        }, { onConflict: "source_update_id", ignoreDuplicates: true });
        if (error) throw error;
        await db.from("members").update({ last_active_at: new Date().toISOString() }).eq("id", mem.id);
        await db.from("activity_events").insert({ member_id: mem.id, event_type: "message_received" });
        const { data: msg, error: msgError } = await db.from("messages").select("id").eq("source_update_id", update.update_id).single();
        if (msgError) throw msgError;
        await publishMessage(msg.id);
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
 * Direct private broadcast. Sent recipients are never deliberately resent.
 * Telegram retries the webhook if transient failures or pending recipients remain.
 */
export async function publishMessage(messageId: string) {
  const db = await admin();
  const { error } = await db.rpc("enqueue_private_message", { _message_id: messageId });
  if (error) throw error;
  const { data: src, error: srcErr } = await db.from("messages").select("telegram_chat_message_ref, body, reply_to_id").eq("id", messageId).single();
  if (srcErr) throw srcErr;
  const ref = mediaRef(src.telegram_chat_message_ref);
  const entities = entitiesOf(src.telegram_chat_message_ref);
  const notice = await noticeFor(src);
  const showButtons = votesEnabled(await votePolicy(), ref?.media);
  const markup = showButtons ? { reply_markup: voteKeyboard() } : {};
  for (let batch = 0; batch < 5; batch++) {
    const { data: rows, error: claimError } = await db.rpc("claim_private_deliveries_v2", { _message_id: messageId });
    if (claimError) throw claimError;
    if (!rows?.length) break;
    let temporaryFailure = false;
    await Promise.all(rows.map(async (row) => {
      let patch: { status: string; sent_at?: string; telegram_message_id?: number; last_error: string | null };
      try {
        const sent = ref
          ? await tg<{ message_id: number }>("copyMessage", {
              chat_id: row.chat_id, from_chat_id: ref.chat_id, message_id: ref.message_id,
              ...(ref.media === "sticker" ? {} : { parse_mode: "HTML", caption: buildMessageHtml({ ...row, entities, notice: notice(row.chat_id) }, !row.reply_message_id, 900) }),
              ...(row.reply_message_id ? { reply_parameters: { message_id: row.reply_message_id, allow_sending_without_reply: true } } : {}),
              ...markup,
            })
          : await tg<{ message_id: number }>("sendMessage", { ...telegramMessagePayload({ ...row, entities, notice: notice(row.chat_id) }), ...markup });
        patch = { status: "sent", sent_at: new Date().toISOString(), telegram_message_id: sent.message_id, last_error: null };
      } catch (e) {
        const permanent = e instanceof TelegramError && (e.status === 403 || e.status === 400);
        if (!permanent) temporaryFailure = true;
        patch = { status: permanent ? "unreachable" : "failed", last_error: e instanceof Error ? e.message.slice(0, 500) : "error" };
      }
      const { error: saveError } = await db.from("telegram_deliveries").update(patch).eq("id", row.id);
      if (saveError) throw saveError;
    }));
    if (temporaryFailure) throw new TelegramError("Baadhi ya ujumbe utajaribiwa tena", 503, true);
  }
  const { data: source, error: sourceError } = await db.from("messages").select("member_id").eq("id", messageId).single();
  if (sourceError) throw sourceError;
  let pendingQuery = db.from("telegram_deliveries").select("id", { count: "exact", head: true }).eq("message_id", messageId);
  if (source.member_id) pendingQuery = pendingQuery.neq("member_id", source.member_id);
  const { count, error: countError } = await pendingQuery.in("status", ["pending", "failed", "sending"]);
  if (countError) throw countError;
  if (count) throw new TelegramError("Usambazaji unaendelea", 503, true);
  const { error: finishError } = await db.from("messages").update({ processing_status: "published", publication_error: null }).eq("id", messageId);
  if (finishError) throw finishError;
}

function mediaRef(v: unknown): { chat_id: number; message_id: number; media: string } | null {
  const r = v as { chat_id?: number; message_id?: number; media?: string | null } | null;
  return r?.media && r.chat_id && r.message_id ? { chat_id: r.chat_id, message_id: r.message_id, media: r.media } : null;
}

/** Edits every delivered copy so anonymous aggregate reaction counts appear on the message itself. Failures never fail the update. */
async function syncReactionEdits(messageId: string) {
  const db = await admin();
  const { data: summary, error: summaryError } = await db.rpc("get_reaction_summary", { _message_id: messageId });
  if (summaryError) throw summaryError;
  const { data: msg, error: msgError } = await db.from("messages").select("sender_label, body, reply_to_id, telegram_chat_message_ref").eq("id", messageId).single();
  if (msgError) throw msgError;
  let reply: { reply_label: string; reply_body: string | null } | undefined;
  if (msg.reply_to_id) {
    const { data: parent } = await db.from("messages").select("sender_label, body").eq("id", msg.reply_to_id).maybeSingle();
    if (parent) reply = { reply_label: parent.sender_label, reply_body: parent.body };
  }
  const ref = mediaRef(msg.telegram_chat_message_ref);
  const entities = entitiesOf(msg.telegram_chat_message_ref);
  const sticker = ref?.media === "sticker";
  const reply_markup = votesEnabled(await votePolicy(), ref?.media) ? voteKeyboard(summary ?? []) : { inline_keyboard: [] };
  const notice = await noticeFor({ body: msg.body, reply_to_id: msg.reply_to_id });
  const footerCounts = (summary ?? []).filter((r) => r.emoji !== "✅" && r.emoji !== "❌");
  const textFor = (chatId: number) => {
    const row = { sender_label: msg.sender_label, body: msg.body, entities, notice: notice(chatId), ...reply };
    return withReactionFooter(ref ? buildMessageHtml(row, true, 900) : telegramStoredMessageText(row), footerCounts);
  };
  const { data: deliveries, error: delError } = await db.from("telegram_deliveries").select("telegram_message_id, members(telegram_user_id)").eq("message_id", messageId).eq("status", "sent");
  if (delError) throw delError;
  await Promise.all((deliveries ?? []).map(async (d) => {
    const chatId = (d.members as { telegram_user_id: number } | null)?.telegram_user_id;
    if (!chatId || !d.telegram_message_id) return;
    const text = textFor(chatId);
    try {
      if (sticker) await tg("editMessageReplyMarkup", { chat_id: chatId, message_id: d.telegram_message_id, reply_markup });
      else await tg(ref ? "editMessageCaption" : "editMessageText", { chat_id: chatId, message_id: d.telegram_message_id, parse_mode: "HTML", reply_markup, ...(ref ? { caption: text } : { text }) });
    } catch (e) {
      // "message is not modified" or a deleted copy is expected; never fail the update.
      log("warn", "reaction_edit_failed", { error: e instanceof Error ? e.message : "error" });
    }
  }));
}

function entitiesOf(v: unknown): TgEntity[] {
  return normalizeEntities((v as { entities?: unknown } | null)?.entities);
}

function origRef(v: unknown): { chat_id: number; message_id: number } | null {
  const r = v as { chat_id?: number; message_id?: number } | null;
  return r?.chat_id && r.message_id ? { chat_id: r.chat_id, message_id: r.message_id } : null;
}

/** Hurudisha kazi inayotoa mstari wa arifa (jibu/tag) kwa kila mpokeaji. */
async function noticeFor(msg: { body: string | null; reply_to_id: string | null }) {
  const db = await admin();
  let replyChat: number | null = null;
  if (msg.reply_to_id) {
    const { data: parent } = await db.from("messages").select("telegram_chat_message_ref").eq("id", msg.reply_to_id).maybeSingle();
    replyChat = origRef(parent?.telegram_chat_message_ref)?.chat_id ?? null;
  }
  const tagged = new Set<number>();
  const tags = [...new Set((msg.body?.match(/@([A-Za-z0-9]{1,12})/g) ?? []).map((s) => s.slice(1).toUpperCase()))].slice(0, 5);
  if (tags.length) {
    const { data: rows } = await db.from("members").select("telegram_user_id, public_identities!inner(label)").eq("status", "active").in("public_identities.label", tags);
    for (const r of rows ?? []) tagged.add(r.telegram_user_id);
  }
  return (chatId: number) => {
    const replied = chatId === replyChat, mentioned = tagged.has(chatId);
    if (replied && mentioned) return "🔔 <b>Amejibu ujumbe wako na kukutaja</b>\n";
    if (replied) return "🔔 <b>Amejibu ujumbe wako</b>\n";
    if (mentioned) return "🔔 <b>Umetajwa</b>\n";
    return "";
  };
}

// ---- Historia na kutafuta (muda wote ni saa za Afrika Mashariki) ----

// Kinga ndogo dhidi ya kubonyeza mara nyingi (kwa kila seva, si kamili).
const historyLast = new Map<number, number>();
const searchLast = new Map<number, number>();
const MEDIA_LABEL: Record<string, string> = {
  photo: "📷 Picha", video: "🎥 Video", document: "📄 Faili", voice: "🎤 Sauti",
  audio: "🎵 Sauti", sticker: "🙂 Sticker", animation: "🎞 GIF",
};
const timeFmt = new Intl.DateTimeFormat("en-GB", { timeZone: "Africa/Dar_es_Salaam", hour: "2-digit", minute: "2-digit", hour12: false });
const dateTimeFmt = new Intl.DateTimeFormat("en-GB", { timeZone: "Africa/Dar_es_Salaam", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false });

/** Mstari mmoja wa muhtasari: muda, utambulisho, lebo ya faili na maandishi. */
function historyLine(r: { sender_label: string; body: string | null; created_at: string; telegram_chat_message_ref: unknown }, fmt: Intl.DateTimeFormat): string | null {
  const media = mediaRef(r.telegram_chat_message_ref)?.media;
  const text = Array.from(r.body ?? "").slice(0, 200).join("");
  const ents = entitiesOf(r.telegram_chat_message_ref).filter((e) => e.type !== "blockquote" && e.type !== "expandable_blockquote");
  const parts = [media ? (MEDIA_LABEL[media] ?? "📎 Faili") : "", text ? entitiesToHtml(text, ents) : ""].filter(Boolean);
  if (!parts.length) return null;
  const d = new Date(r.created_at);
  const time = Number.isNaN(d.getTime()) ? "" : `<code>${fmt.format(d)}</code> `;
  return `${time}<b>${escapeHtml(r.sender_label)}</b>: ${parts.join(" · ")}`;
}

/** Hugawa mistari katika vipande visivyozidi mipaka ya Telegram. */
function chunkLines(lines: string[]) {
  const chunks: string[] = [];
  let cur = "";
  for (const line of lines) {
    if (cur && cur.length + line.length + 1 > 3500) { chunks.push(cur); cur = ""; }
    cur += (cur ? "\n" : "") + line;
  }
  if (cur) chunks.push(cur);
  return chunks;
}

/** Hutuma vipande kimoja kimoja kwa pengo la sekunde ~1 (kikomo cha Telegram kwa chat moja). */
async function sendChunks(chatId: number, chunks: string[]) {
  for (let i = 0; i < chunks.length; i++) {
    if (i > 0) await new Promise((r) => setTimeout(r, 1100));
    await tg("sendMessage", { chat_id: chatId, text: chunks[i]!, parse_mode: "HTML", disable_notification: i > 0 });
  }
}

/** Hutuma ujumbe wa masaa 24 yaliyopita (hadi 100) kama vipande vichache. */
async function sendHistory(chatId: number, userId: number) {
  const now = Date.now();
  if (now - (historyLast.get(userId) ?? 0) < 60_000) {
    await tg("sendMessage", { chat_id: chatId, text: "⏳ Subiri dakika moja kisha ujaribu tena." });
    return;
  }
  if (historyLast.size > 1000) historyLast.clear();
  historyLast.set(userId, now);
  try {
    const db = await admin();
    const since = new Date(now - 24 * 60 * 60 * 1000).toISOString();
    const { data, count, error } = await db.from("messages")
      .select("sender_label, body, created_at, telegram_chat_message_ref", { count: "exact" })
      .eq("processing_status", "published").gte("created_at", since)
      .order("created_at", { ascending: false }).limit(100);
    if (error) throw error;
    const rows = (data ?? []).reverse();
    const lines = rows.map((r) => historyLine(r, timeFmt)).filter((l): l is string => !!l);
    if (!lines.length) {
      await tg("sendMessage", { chat_id: chatId, text: "Hakuna mazungumzo ya masaa 24 yaliyopita." });
      return;
    }
    const shown = chunkLines(lines).slice(-8);
    shown[0] = `📜 <b>Mazungumzo ya masaa 24 yaliyopita</b>\n\n${shown[0]}`;
    if ((count ?? 0) > rows.length) shown[shown.length - 1] += `\n\n<i>Zinaonyeshwa za mwisho ${rows.length} kati ya ${count}.</i>`;
    await sendChunks(chatId, shown);
  } catch (e) {
    log("error", "history_failed", { error: e instanceof Error ? e.message : JSON.stringify(e) });
    await tg("sendMessage", { chat_id: chatId, text: "⚠️ Imeshindikana kuonyesha mazungumzo ya awali. Jaribu tena baadaye." }).catch(() => {});
  }
}

/** /tafuta neno  au  /tafuta @A12 — hurudisha ujumbe 15 wa mwisho unaolingana. */
async function searchMessages(chatId: number, userId: number, query: string) {
  const byLabel = query.startsWith("@");
  const label = byLabel ? query.slice(1).trim() : "";
  if (byLabel ? !/^[A-Za-z0-9]{1,12}$/.test(label) : query.length < 2) {
    await tg("sendMessage", { chat_id: chatId, parse_mode: "HTML", text: "🔎 Andika <code>/tafuta neno</code> kutafuta maneno, au <code>/tafuta @A12</code> kuona ujumbe wa utambulisho mmoja." });
    return;
  }
  const now = Date.now();
  if (now - (searchLast.get(userId) ?? 0) < 10_000) {
    await tg("sendMessage", { chat_id: chatId, text: "⏳ Subiri sekunde chache kisha ujaribu tena." });
    return;
  }
  if (searchLast.size > 1000) searchLast.clear();
  searchLast.set(userId, now);
  try {
    const db = await admin();
    let q = db.from("messages")
      .select("sender_label, body, created_at, telegram_chat_message_ref", { count: "exact" })
      .eq("processing_status", "published");
    q = byLabel ? q.ilike("sender_label", label) : q.ilike("body", `%${query.replace(/[\\%_]/g, "\\$&")}%`);
    const { data, count, error } = await q.order("created_at", { ascending: false }).limit(15);
    if (error) throw error;
    const rows = data ?? [];
    const lines = rows.map((r) => historyLine(r, dateTimeFmt)).filter((l): l is string => !!l);
    if (!lines.length) {
      await tg("sendMessage", { chat_id: chatId, parse_mode: "HTML", text: `Hakuna ujumbe uliopatikana kwa “${escapeHtml(query)}”.` });
      return;
    }
    const chunks = chunkLines(lines).slice(0, 4);
    chunks[0] = `🔎 <b>Matokeo ya “${escapeHtml(query)}”</b>\n\n${chunks[0]}`;
    if ((count ?? 0) > rows.length) chunks[chunks.length - 1] += `\n\n<i>Zinaonyeshwa 15 za hivi karibuni kati ya ${count}. Andika neno mahususi zaidi.</i>`;
    await sendChunks(chatId, chunks);
  } catch (e) {
    log("error", "search_failed", { error: e instanceof Error ? e.message : JSON.stringify(e) });
    await tg("sendMessage", { chat_id: chatId, text: "⚠️ Imeshindikana kutafuta. Jaribu tena baadaye." }).catch(() => {});
  }
}