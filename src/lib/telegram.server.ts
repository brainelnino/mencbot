// Server-only Telegram service. Never import from browser code.
import { classifyUpdate, findBlockedTerm, hasLink, hasPhone, type TgUpdate } from "./telegram-parse";
import { contentRejection, parsePolicy } from "./content-policy";
import { t } from "./i18n";
import { buildMessageHtml, telegramMessagePayload, telegramStoredMessageText, voteKeyboard, withReactionFooter } from "./telegram-format";

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

/** Processes one verified update idempotently. */
export async function handleUpdate(update: TgUpdate) {
  const db = await admin();
  const c = classifyUpdate(update);

  // Idempotency: claim the update_id. Duplicate deliveries of processed updates are skipped.
  const { error: insErr } = await db.from("telegram_updates").insert({ update_id: update.update_id, update_kind: c.kind });
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
        log("info", "registered", { is_new: row.is_new });
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
          reply_to_id: replyToId, telegram_chat_message_ref: { message_id: c.messageId, chat_id: c.chatId, media },
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
  const { data: src, error: srcErr } = await db.from("messages").select("telegram_chat_message_ref").eq("id", messageId).single();
  if (srcErr) throw srcErr;
  const ref = mediaRef(src.telegram_chat_message_ref);
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
              ...(ref.media === "sticker" ? {} : { parse_mode: "HTML", caption: buildMessageHtml(row, !row.reply_message_id, 900) }),
              ...(row.reply_message_id ? { reply_parameters: { message_id: row.reply_message_id, allow_sending_without_reply: true } } : {}),
              reply_markup: voteKeyboard(),
            })
          : await tg<{ message_id: number }>("sendMessage", { ...telegramMessagePayload(row), reply_markup: voteKeyboard() });
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
  const sticker = ref?.media === "sticker";
  const reply_markup = voteKeyboard(summary ?? []);
  const text = withReactionFooter(ref ? buildMessageHtml({ sender_label: msg.sender_label, body: msg.body, ...reply }, true, 900) : telegramStoredMessageText({ sender_label: msg.sender_label, body: msg.body, ...reply }), summary ?? []);
  const { data: deliveries, error: delError } = await db.from("telegram_deliveries").select("telegram_message_id, members(telegram_user_id)").eq("message_id", messageId).eq("status", "sent");
  if (delError) throw delError;
  await Promise.all((deliveries ?? []).map(async (d) => {
    const chatId = (d.members as { telegram_user_id: number } | null)?.telegram_user_id;
    if (!chatId || !d.telegram_message_id) return;
    try {
      if (sticker) await tg("editMessageReplyMarkup", { chat_id: chatId, message_id: d.telegram_message_id, reply_markup });
      else await tg(ref ? "editMessageCaption" : "editMessageText", { chat_id: chatId, message_id: d.telegram_message_id, parse_mode: "HTML", reply_markup, ...(ref ? { caption: text } : { text }) });
    } catch (e) {
      // "message is not modified" or a deleted copy is expected; never fail the update.
      log("warn", "reaction_edit_failed", { error: e instanceof Error ? e.message : "error" });
    }
  }));
}
