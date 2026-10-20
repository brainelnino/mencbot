// Server-only Telegram service. Never import from browser code.
import { classifyUpdate, type TgUpdate } from "./telegram-parse";

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
  throw last!;
}

async function admin() {
  return (await import("@/integrations/supabase/client.server")).supabaseAdmin;
}

async function recordConfig(patch: Record<string, unknown>) {
  const db = await admin();
  const { data } = await db.from("telegram_config").select("id").limit(1).maybeSingle();
  if (data) await db.from("telegram_config").update({ ...patch, updated_at: new Date().toISOString() }).eq("id", data.id);
}

const WELCOME_NEW = (l: string) => `Karibu EL-NINO — Ubongo wa Jamii! 🇹🇿\n\nUtambulisho wako wa umma ni: ${l}\n\nJina lako la Telegram, namba ya simu na taarifa zako binafsi hazitaonyeshwa kamwe. Ujumbe wako utaonekana hadharani kwa utambulisho ${l} pekee, baada ya kukaguliwa.`;
const WELCOME_BACK = (l: string) => `Karibu tena! Utambulisho wako wa umma bado ni: ${l}`;

/** Processes one verified update idempotently. */
export async function handleUpdate(update: TgUpdate) {
  const db = await admin();
  const c = classifyUpdate(update);

  // Idempotency: claim the update_id. Duplicate deliveries of processed updates are skipped.
  const { error: insErr } = await db.from("telegram_updates").insert({ update_id: update.update_id, update_kind: c.kind });
  if (insErr) {
    if (insErr.code !== "23505") throw insErr;
    const { data: prev } = await db.from("telegram_updates").select("status,attempts").eq("update_id", update.update_id).single();
    if (prev && prev.status !== "failed") { log("info", "duplicate_skipped", { update_id: update.update_id }); return; }
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
        await tg("sendMessage", { chat_id: c.chatId, text: row.is_new ? WELCOME_NEW(row.label) : WELCOME_BACK(row.label) });
        log("info", "registered", { is_new: row.is_new });
        break;
      }
      case "private_text": {
        const { data: mem } = await db.from("members").select("id,status,public_identities(label)").eq("telegram_user_id", c.userId).maybeSingle();
        const label = (mem?.public_identities as { label: string } | null)?.label;
        if (!mem || !label) {
          await tg("sendMessage", { chat_id: c.chatId, text: "Tuma /start kwanza ili kujisajili." });
          break;
        }
        if (mem.status === "banned") { status = "ignored"; break; }
        // Safe review state: never published until moderation approves it.
        const { error } = await db.from("messages").upsert({
          member_id: mem.id, sender_label: label, kind: "text", body: c.text,
          source_update_id: update.update_id, moderation_status: "pending",
          publication_status: "unpublished", processing_status: "awaiting_moderation",
        }, { onConflict: "source_update_id", ignoreDuplicates: true });
        if (error) throw error;
        await db.from("members").update({ last_active_at: new Date().toISOString() }).eq("id", mem.id);
        await db.from("activity_events").insert({ member_id: mem.id, event_type: "message_received" });
        await tg("sendMessage", { chat_id: c.chatId, text: "Ujumbe wako umepokelewa na unasubiri ukaguzi kabla ya kuchapishwa." });
        break;
      }
      case "private_other":
        await tg("sendMessage", { chat_id: c.chatId, text: "Kwa sasa ujumbe wa maandishi pekee unakubaliwa." });
        break;
      case "group_link": {
        const { data: cfg } = await db.from("telegram_config").select("id,group_link_code,group_link_expires_at").limit(1).maybeSingle();
        const valid = cfg?.group_link_code && cfg.group_link_code === c.code && cfg.group_link_expires_at && new Date(cfg.group_link_expires_at) > new Date();
        if (!valid) { status = "ignored"; break; }
        const sent = await tg<{ message_id: number }>("sendMessage", { chat_id: c.chatId, text: "✅ Kikundi hiki kimeunganishwa na EL-NINO. Ujumbe ulioidhinishwa utachapishwa hapa." });
        await db.from("telegram_config").update({
          public_group_chat_id: c.chatId, group_title: c.title, group_verified_at: new Date().toISOString(),
          group_link_code: null, group_link_expires_at: null,
        }).eq("id", cfg!.id);
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
 * Publication service: the only path to the public group and the web feed.
 * Requires moderation approval; claims the row so retries never double-post.
 */
export async function publishMessage(messageId: string) {
  const db = await admin();
  const { data: cfg } = await db.from("telegram_config").select("public_group_chat_id").limit(1).maybeSingle();
  if (!cfg?.public_group_chat_id) throw new Error("Kikundi cha umma hakijaunganishwa");
  const { data: claimed, error } = await db.from("messages")
    .update({ processing_status: "publishing" })
    .eq("id", messageId).eq("moderation_status", "approved").eq("publication_status", "unpublished")
    .is("telegram_message_id", null).neq("processing_status", "publishing")
    .select("id,sender_label,body,publish_attempts").maybeSingle();
  if (error) throw error;
  if (!claimed) throw new Error("Ujumbe haujaidhinishwa, umeshachapishwa, au unachapishwa sasa");
  try {
    const sent = await tg<{ message_id: number }>("sendMessage", { chat_id: cfg.public_group_chat_id, text: `${claimed.sender_label}\n> ${claimed.body ?? ""}` });
    await db.from("messages").update({
      telegram_message_id: sent.message_id, publication_status: "published", published_at: new Date().toISOString(),
      processing_status: "published", publication_error: null, publish_attempts: claimed.publish_attempts + 1,
    }).eq("id", messageId);
  } catch (e) {
    await db.from("messages").update({
      processing_status: "publish_failed", publication_error: e instanceof Error ? e.message.slice(0, 500) : "error",
      publish_attempts: claimed.publish_attempts + 1,
    }).eq("id", messageId);
    throw e;
  }
}
