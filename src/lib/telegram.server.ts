// Server-only Telegram service. Never import from browser code.
import { NAME_PROMPT, SEARCH_PROMPT, classifyUpdate, findBlockedTerm, hasLink, hasPhone, normalizeEntities, type MediaType, type TgEntity, type TgUpdate } from "./telegram-parse";
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

// ---- Mapendeleo ya mtumiaji (yanahifadhiwa kwenye system_settings, bila jedwali jipya) ----

async function getSetting<T = unknown>(key: string): Promise<T | null> {
  const { data } = await (await admin()).from("system_settings").select("value").eq("key", key).maybeSingle();
  return (data?.value as T | undefined) ?? null;
}

async function putSetting(key: string, value: unknown) {
  const db = await admin();
  const upd = await db.from("system_settings").update({ value } as never).eq("key", key).select("key");
  if (upd.error) throw upd.error;
  if (upd.data && upd.data.length) return;
  const ins = await db.from("system_settings").insert({ key, value } as never);
  if (ins.error) throw ins.error;
}

async function dropSetting(key: string) {
  await (await admin()).from("system_settings").delete().eq("key", key);
}

async function isSilent(userId: number) {
  return !!(await getSetting(`silent:${userId}`));
}

/** Huwasha/huzima hali ya kimya; hurudisha hali mpya. */
async function toggleSilent(userId: number): Promise<boolean> {
  if (await isSilent(userId)) { await dropSetting(`silent:${userId}`); return false; }
  await putSetting(`silent:${userId}`, { on: true });
  return true;
}

/** Chat zote zilizowasha hali ya kimya. */
async function silentChats(): Promise<Set<number>> {
  try {
    const { data } = await (await admin()).from("system_settings").select("key").like("key", "silent:%").limit(2000);
    return new Set((data ?? []).map((r) => Number(String(r.key).slice(7))).filter((n) => Number.isFinite(n)));
  } catch (e) {
    log("warn", "silent_lookup_failed", { error: e instanceof Error ? e.message : JSON.stringify(e) });
    return new Set();
  }
}

async function nickOfUser(userId: number): Promise<string | null> {
  const v = await getSetting<{ name?: string }>(`nick:${userId}`);
  return typeof v?.name === "string" && v.name ? v.name : null;
}

// ---- Jinsia (🟢 mwanamke, 🔴 mwanaume): huulizwa mara moja wakati wa kujisajili ----

type Gender = "f" | "m";
const GENDER_EMOJI: Record<Gender, string> = { f: "🟢", m: "🔴" };

async function genderOfUser(userId: number): Promise<Gender | null> {
  const v = await getSetting<{ g?: string }>(`gender:${userId}`);
  return v?.g === "f" || v?.g === "m" ? v.g : null;
}

const GENDER_QUESTION = "👋 Swali moja tu kabla ya kuanza:\n\n🟢 Mwanamke\n🔴 Mwanaume\n\nBonyeza chaguo lako. Rangi hiyo itaonekana kando ya namba yako, na haibadiliki baadaye.";
const genderKeyboard = { inline_keyboard: [[{ text: "🟢 Mwanamke", callback_data: "g:f" }, { text: "🔴 Mwanaume", callback_data: "g:m" }]] };

/**
 * Muonekano wa utambulisho:
 *  - ana jinsia na jina → "🟢12 · Juma"
 *  - hana jinsia, ana jina → "12 · Juma"
 *  - ana jinsia tu → "🟢12"
 * Jina na jinsia vilivyohifadhiwa kwenye ujumbe wakati ulipotumwa (`nick`, `g`).
 */
function labelWithNick(label: string, ref: unknown) {
  const r = ref as { nick?: unknown; g?: unknown } | null;
  const g = r?.g === "f" || r?.g === "m" ? GENDER_EMOJI[r.g] : "";
  const n = typeof r?.nick === "string" && r.nick ? ` · ${r.nick}` : "";
  return `${g}${label}${n}`;
}

const NICK_RE = /^[\p{L}\p{M}][\p{L}\p{M} .'’-]{1,19}$/u;

// ---- Menyu (dashboard ya vitufe) ----

const menuKeyboard = (silent: boolean) => ({
  inline_keyboard: [
    [{ text: "🆔 Mimi", callback_data: "m:me" }, { text: "✏️ Jina", callback_data: "m:name" }],
    [{ text: "🔐 Ruhusa", callback_data: "m:perm" }, { text: silent ? "🔕 Kimya ✅" : "🔔 Kimya", callback_data: "m:quiet" }],
    [{ text: "📜 Historia", callback_data: "m:hist" }, { text: "🔎 Tafuta", callback_data: "m:search" }],
  ],
});

const backKeyboard = { inline_keyboard: [[{ text: "⬅️ Rudi", callback_data: "m:home" }]] };

async function renderMenu(userId: number, isNew = false) {
  const db = await admin();
  const [{ data: mem }, nick, silent, gender] = await Promise.all([
    db.from("members").select("public_identities(label)").eq("telegram_user_id", userId).maybeSingle(),
    nickOfUser(userId),
    isSilent(userId),
    genderOfUser(userId),
  ]);
  const label = (mem?.public_identities as { label: string } | null)?.label ?? "?";
  const shown = labelWithNick(label, { nick, g: gender });
  const text = `🏠 <b>Menyu</b>\n🆔 Wewe ni <b>${escapeHtml(shown)}</b>\n${isNew ? "\n💡 Ukiona ujumbe ni mwingi, bonyeza 🔔 Kimya.\n" : ""}\nChagua 👇`;
  return { text, markup: menuKeyboard(silent) };
}

/**
 * Orodha ya vinavyoruhusiwa na visivyoruhusiwa, kulingana na sheria za admin.
 * Inaonyesha sheria za wanachama wa kawaida; akaunti iliyosamehewa (exempt) hupata maelezo ya ziada.
 */
async function permissionsText(exempt: boolean) {
  const db = await admin();
  const { data: policyRow } = await db.from("system_settings").select("value").eq("key", "content_policy").maybeSingle();
  const policy = parsePolicy(policyRow?.value);
  // false = tunaonyesha sheria za wanachama wa kawaida, si ruhusa ya akaunti iliyosamehewa.
  const ok = (media: MediaType | null, link = false, phone = false) => contentRejection(policy, false, media, link, phone) === null;
  const rows: Array<[string, boolean]> = [
    ["💬 Maandishi", true],
    ["📷 Picha", ok("photo")],
    ["🎥 Video", ok("video")],
    ["📄 Faili", ok("document")],
    ["🎤 Sauti", ok("voice")],
    ["🎵 Muziki", ok("audio")],
    ["🙂 Sticker", ok("sticker")],
    ["🎞 GIF", ok("animation")],
    ["🔗 Link", ok(null, true, false)],
    ["📞 Namba za simu", ok(null, false, true)],
  ];
  const note = exempt ? "\n\n⭐ <i>Wewe umesamehewa: unaweza kutuma kila kitu. Orodha hii ni ya wanachama wa kawaida.</i>" : "";
  return `🔐 <b>Ruhusa zako</b>\n\n${rows.map(([n, a]) => `${a ? "✅" : "🚫"} ${n}`).join("\n")}\n\n✅ unaruhusiwa · 🚫 imezuiwa kwa sasa${note}`;
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

// ---- Matangazo (banner + orodha + kitufe cha View Details + kubandikwa kwa wote) ----

function announceOf(v: unknown): { html: string; details: string } | null {
  const a = (v as { announce?: { html?: unknown; details?: unknown } } | null)?.announce;
  return a && typeof a.html === "string" ? { html: a.html, details: typeof a.details === "string" ? a.details : "" } : null;
}

/** Hugawa maandishi ya admin: kichwa, utangulizi, orodha (-), sanduku la mwisho (>), na maelezo baada ya ---. */
function parseAnnouncement(raw: string) {
  const parts = raw.split(/\n\s*-{3,}\s*(?:\n|$)/);
  const main = parts[0] ?? "";
  const details = parts.slice(1).join("\n").trim();
  const lines = main.split("\n").map((l) => l.trim()).filter(Boolean);
  const title = lines.shift() ?? "";
  const isBullet = (l: string) => /^[-•*]\s+/.test(l);
  const bullets = lines.filter(isBullet).map((l) => l.replace(/^[-•*]\s+/, ""));
  const footer = lines.find((l) => l.startsWith(">"))?.replace(/^>\s*/, "") ?? "";
  const intro = lines.filter((l) => !isBullet(l) && !l.startsWith(">"));
  return { title, intro, bullets, footer, details };
}

function announceHtml(a: { title: string; intro: string[]; bullets: string[]; footer: string }) {
  const head = `✅ <b><i>${escapeHtml(a.title)}</i></b>${a.intro.length ? `\n${a.intro.map(escapeHtml).join("\n")}` : ""}`;
  const parts = ["📢 <b><i>Tangazo Jipya</i></b>", head];
  if (a.bullets.length) parts.push(`<blockquote>⭐ <b>Mabadiliko Muhimu:</b></blockquote>\n${a.bullets.map((b) => `✅ ${escapeHtml(b)}`).join("\n")}`);
  if (a.footer) parts.push(`<blockquote>🚀 <i>${escapeHtml(a.footer)}</i></blockquote>`);
  return parts.join("\n\n");
}

/** Urefu wa maandishi yanayoonekana (bila tagi), kwa kikomo cha caption ya Telegram. */
function plainLength(html: string) {
  return Array.from(html.replace(/<[^>]*>/g, "").replace(/&(amp|lt|gt);/g, "x")).length;
}

const ANNOUNCE_USAGE = [
  "📢 <b>Jinsi ya kutuma tangazo</b>",
  "Tuma picha ya banner yenye maelezo (caption), au ujumbe wa maandishi, ukianza na /tangazo:",
  "",
  "<code>/tangazo Update Mpya!",
  "Tumeongeza vipengele vipya 🎉",
  "- Ujumbe wa Reply kuwa Private",
  "- Uendeshaji wa haraka",
  "&gt; Asante kwa kuwa sehemu ya familia yetu!",
  "---",
  "Maelezo kamili ya kitufe cha View Details</code>",
  "",
  "• Mstari wa kwanza ni kichwa",
  "• Mistari ya <code>-</code> ni orodha ya ✅",
  "• Mstari wa <code>&gt;</code> ni sanduku la mwisho",
  "• Baada ya <code>---</code> ni maelezo ya kitufe cha View Details (hiari)",
  "• Tangazo linabandikwa kwa wote kiotomatiki, na la awali linaondolewa",
].join("\n");

// Majibu ya mzaha kwa command isiyojulikana (haisambazwi kwa wengine).
const RIP_LINES = [
  "🪦 <b>R.I.P this command</b>",
  "⚰️ <b>R.I.P this command</b> — ilizikwa bila kuzaliwa",
  "💀 <b>R.I.P this command</b> — mfumo haikuijua",
  "🪦 <b>R.I.P this command</b> — 404, haipo",
];

/** Processes one verified update idempotently. */
export async function handleUpdate(update: TgUpdate) {
  const db = await admin();
  const c = classifyUpdate(update);

  // Idempotency: claim the update_id. Duplicate deliveries of processed updates are skipped.
  // Aina mpya zinahifadhiwa kama "private_other" ili safu ya update_kind isikatae thamani mpya.
  const kindForDb = c.kind === "history" || c.kind === "search" || c.kind === "admin_pin" || c.kind === "admin_poll" || c.kind === "admin_diag" || c.kind === "admin_announce" || c.kind === "announce_details" || c.kind === "unknown_command" || c.kind === "poll_vote" || c.kind === "menu" || c.kind === "silent_toggle" || c.kind === "delete_message" || c.kind === "set_name" || c.kind === "gender" ? "private_other" : c.kind;
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
        log("info", "registered", { is_new: row.is_new });
        // Swali la jinsia huulizwa mara moja tu (kwa wasiojibu bado).
        if (!(await genderOfUser(c.userId))) {
          await tg("sendMessage", { chat_id: c.chatId, text: GENDER_QUESTION, reply_markup: genderKeyboard });
          break;
        }
        const view = await renderMenu(c.userId, !!row.is_new);
        await tg("sendMessage", { chat_id: c.chatId, parse_mode: "HTML", text: view.text, reply_markup: view.markup });
        break;
      }
      case "gender": {
        const answer = (text = "") => tg("answerCallbackQuery", { callback_query_id: c.callbackId, ...(text ? { text } : {}) }).catch(() => {});
        const { data: mem } = await db.from("members").select("id,status").eq("telegram_user_id", c.userId).maybeSingle();
        if (!mem || mem.status !== "active") { await answer("Tuma /start kwanza."); status = "ignored"; break; }
        if (await genderOfUser(c.userId)) {
          await answer("Tayari umechagua.");
          await tg("editMessageReplyMarkup", { chat_id: c.chatId, message_id: c.messageId, reply_markup: { inline_keyboard: [] } }).catch(() => {});
          status = "ignored"; break;
        }
        try {
          await putSetting(`gender:${c.userId}`, { g: c.value });
        } catch (e) {
          log("error", "gender_failed", { error: e instanceof Error ? e.message : JSON.stringify(e) });
          await answer("⚠️ Imeshindikana. Jaribu tena.");
          break;
        }
        await answer(`${GENDER_EMOJI[c.value]} Imehifadhiwa`);
        await tg("editMessageText", { chat_id: c.chatId, message_id: c.messageId, text: `✅ Umechagua ${GENDER_EMOJI[c.value]}` }).catch(() => {});
        const view = await renderMenu(c.userId, true);
        await tg("sendMessage", { chat_id: c.chatId, parse_mode: "HTML", text: view.text, reply_markup: view.markup });
        break;
      }
      case "menu": {
        const answer = (text?: string) => c.callbackId ? tg("answerCallbackQuery", { callback_query_id: c.callbackId, ...(text ? { text } : {}) }).catch(() => {}) : Promise.resolve();
        const { data: mem } = await db.from("members").select("id,status,can_send_restricted,public_identities(label)").eq("telegram_user_id", c.userId).maybeSingle();
        const label = (mem?.public_identities as { label: string } | null)?.label;
        if (!mem || !label) {
          await answer("Tuma /start kwanza.");
          if (!c.callbackId) await tg("sendMessage", { chat_id: c.chatId, text: "Tuma /start kwanza ili kujisajili." });
          status = "ignored"; break;
        }
        if (mem.status !== "active") { await answer(); status = "ignored"; break; }
        const show = async (text: string, markup: unknown) => {
          if (!c.messageId) { await tg("sendMessage", { chat_id: c.chatId, parse_mode: "HTML", text, reply_markup: markup }); return; }
          try {
            await tg("editMessageText", { chat_id: c.chatId, message_id: c.messageId, parse_mode: "HTML", text, reply_markup: markup });
          } catch (e) {
            if (e instanceof TelegramError && /not modified/i.test(e.message)) return;
            await tg("sendMessage", { chat_id: c.chatId, parse_mode: "HTML", text, reply_markup: markup });
          }
        };
        const nameView = async () => {
          const [nick, gender] = await Promise.all([nickOfUser(c.userId), genderOfUser(c.userId)]);
          const shown = labelWithNick(label, { g: gender });
          await show(
            `✏️ <b>Jina</b>\n\nNamba yako: <b>${escapeHtml(shown)}</b>\nJina: ${nick ? `<b>${escapeHtml(nick)}</b>` : "<i>halijawekwa</i>"}\n\n<i>Beta: jina linaongezwa kando ya namba yako (mfano ${escapeHtml(shown)} · Juma). Namba haiondoki.</i>`,
            { inline_keyboard: [[{ text: "✏️ Weka", callback_data: "m:setname" }, { text: "🗑 Ondoa", callback_data: "m:delname" }], [{ text: "⬅️ Rudi", callback_data: "m:home" }]] },
          );
        };
        const act = c.action;
        if (act === "me") {
          const { count } = await db.from("messages").select("id", { count: "exact", head: true }).eq("member_id", mem.id).filter("telegram_chat_message_ref->>private", "is", null);
          const [nick, gender] = await Promise.all([nickOfUser(c.userId), genderOfUser(c.userId)]);
          await answer();
          await show(
            `🆔 <b>Mimi</b>\n\nNamba: <b>${escapeHtml(labelWithNick(label, { g: gender }))}</b>\nJina: ${nick ? `<b>${escapeHtml(nick)}</b>` : "<i>halijawekwa</i>"}\nUjumbe wa wazi: <b>${count ?? 0}</b>`,
            { inline_keyboard: [[{ text: "✏️ Jina", callback_data: "m:name" }, { text: "⬅️ Rudi", callback_data: "m:home" }]] },
          );
        } else if (act === "name") {
          await answer();
          await nameView();
        } else if (act === "setname") {
          await answer();
          await tg("sendMessage", { chat_id: c.chatId, text: `${NAME_PROMPT} (herufi 2–20, bila namba). Namba yako itabaki kama ilivyo.`, reply_markup: { force_reply: true, input_field_placeholder: "Jina lako..." } });
        } else if (act === "delname") {
          await dropSetting(`nick:${c.userId}`);
          await answer("🗑 Jina limeondolewa");
          await nameView();
        } else if (act === "perm") {
          await answer();
          await show(await permissionsText(!!mem.can_send_restricted), backKeyboard);
        } else if (act === "quiet") {
          const on = await toggleSilent(c.userId);
          await answer(on ? "🔕 Kimya imewashwa" : "🔔 Kimya imezimwa");
          const view = await renderMenu(c.userId);
          await show(view.text, view.markup);
        } else if (act === "hist") {
          await answer();
          await sendHistory(c.chatId, c.userId);
        } else if (act === "search") {
          await answer();
          await tg("sendMessage", { chat_id: c.chatId, text: `${SEARCH_PROMPT} (au @namba, mfano @12)`, reply_markup: { force_reply: true, input_field_placeholder: "neno..." } });
        } else {
          await answer();
          const view = await renderMenu(c.userId);
          await show(view.text, view.markup);
        }
        break;
      }
      case "silent_toggle": {
        const { data: mem } = await db.from("members").select("id,status").eq("telegram_user_id", c.userId).maybeSingle();
        if (!mem) { await tg("sendMessage", { chat_id: c.chatId, text: "Tuma /start kwanza ili kujisajili." }); break; }
        if (mem.status !== "active") { status = "ignored"; break; }
        try {
          const on = await toggleSilent(c.userId);
          await tg("sendMessage", { chat_id: c.chatId, text: on ? "🔕 Kimya imewashwa: ujumbe utakuja bila sauti (ukijibiwa au ukitajwa bado utapata arifa). Andika /kimya tena kuizima." : "🔔 Kimya imezimwa: ujumbe utakuja na sauti kama kawaida." });
        } catch (e) {
          log("error", "silent_failed", { error: e instanceof Error ? e.message : JSON.stringify(e) });
          await tg("sendMessage", { chat_id: c.chatId, text: "⚠️ Imeshindikana kubadilisha hali ya kimya. Jaribu tena baadaye." });
        }
        break;
      }
      case "set_name": {
        const { data: mem } = await db.from("members").select("id,status,public_identities(label)").eq("telegram_user_id", c.userId).maybeSingle();
        const label = (mem?.public_identities as { label: string } | null)?.label;
        if (!mem || !label) { await tg("sendMessage", { chat_id: c.chatId, text: "Tuma /start kwanza ili kujisajili." }); break; }
        if (mem.status !== "active") { status = "ignored"; break; }
        const name = c.name.trim().replace(/\s+/g, " ");
        const { data: termRows } = await db.from("blocked_terms").select("term");
        const invalid = !NICK_RE.test(name) || /admin|msimamizi/i.test(name) || hasLink(name) || hasPhone(name) || !!findBlockedTerm(name, (termRows ?? []).map((r) => r.term));
        if (invalid) {
          await tg("sendMessage", { chat_id: c.chatId, text: `⚠️ Jina hilo haliruhusiwi. Tumia herufi 2–20, bila namba, link au maneno yaliyokatazwa.\n\n${NAME_PROMPT} (jaribu tena)`, reply_markup: { force_reply: true, input_field_placeholder: "Jina lako..." } });
          break;
        }
        try {
          await putSetting(`nick:${c.userId}`, { name });
          const gender = await genderOfUser(c.userId);
          await tg("sendMessage", { chat_id: c.chatId, parse_mode: "HTML", text: `✅ Jina limewekwa: <b>${escapeHtml(labelWithNick(label, { nick: name, g: gender }))}</b>\nUjumbe mpya utaonekana hivyo. Namba yako inabaki.` });
        } catch (e) {
          log("error", "nick_failed", { error: e instanceof Error ? e.message : JSON.stringify(e) });
          await tg("sendMessage", { chat_id: c.chatId, text: "⚠️ Imeshindikana kuhifadhi jina. Jaribu tena baadaye." });
        }
        break;
      }
      case "delete_message": {
        const { data: mem } = await db.from("members").select("id,status").eq("telegram_user_id", c.userId).maybeSingle();
        if (!mem) { await tg("sendMessage", { chat_id: c.chatId, text: "Tuma /start kwanza ili kujisajili." }); break; }
        if (mem.status !== "active") { status = "ignored"; break; }
        if (c.replyMessageId === null) {
          await tg("sendMessage", { chat_id: c.chatId, text: "🗑 Jibu ujumbe wako unaotaka kufuta kisha andika /futa." });
          break;
        }
        const found = await findDeletable(mem.id, c.userId, c.chatId, c.replyMessageId);
        if (!found) {
          await tg("sendMessage", { chat_id: c.chatId, text: "⚠️ Unaweza kufuta ujumbe wako mwenyewe tu. Jibu ujumbe wako kisha andika /futa." });
          break;
        }
        if (removedOf(found.ref)) { await tg("sendMessage", { chat_id: c.chatId, text: "Ujumbe huo tayari umeondolewa." }); break; }
        const res = await removeEverywhere(found.id, found.ref, found.reason);
        await tg("deleteMessage", { chat_id: c.chatId, message_id: c.messageId }).catch(() => {});
        await tg("sendMessage", {
          chat_id: c.chatId, disable_notification: true,
          text: found.reason === "author" ? "🗑 Ujumbe wako umefutwa kwa wote." : `🗑 Ujumbe umeondolewa kwa chat ${res.done} kati ya ${res.total}.`,
        });
        break;
      }
      case "unknown_command": {
        // Haisambazwi kwa mtu yeyote; mtumaji anapata jibu la mzaha tu.
        const line = RIP_LINES[Math.floor(Math.random() * RIP_LINES.length)]!;
        await tg("sendMessage", {
          chat_id: c.chatId, parse_mode: "HTML",
          text: `${line}\n\n<code>/${escapeHtml(c.command)}</code> haipo, kwa hiyo haikutumwa kwa mtu yeyote.\nZilizopo: /menu · /historia · /tafuta · /kimya · /futa`,
          reply_parameters: { message_id: c.messageId, allow_sending_without_reply: true },
        });
        status = "ignored";
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
      case "admin_announce": {
        const { data: slot, error: slotError } = await db.rpc("get_telegram_admin_slot", { _tg_user_id: c.userId });
        if (slotError) throw slotError;
        if (!slot) { await tg("sendMessage", { chat_id: c.chatId, text: t.telegram.noPermission }); break; }
        const parsed = parseAnnouncement(c.raw);
        if (!parsed.title) { await tg("sendMessage", { chat_id: c.chatId, parse_mode: "HTML", text: ANNOUNCE_USAGE }); break; }
        if (c.media && !["photo", "video", "animation"].includes(c.media)) {
          await tg("sendMessage", { chat_id: c.chatId, text: "⚠️ Tumia picha, video au GIF kama banner." });
          break;
        }
        const html = announceHtml(parsed);
        const limit = c.media ? 1000 : 4000;
        const size = plainLength(html);
        if (size > limit) {
          await tg("sendMessage", { chat_id: c.chatId, text: `⚠️ Tangazo ni refu mno (herufi ${size}, kikomo ${limit}${c.media ? " kwa picha" : ""}). Fupisha${c.media ? " au litume kama maandishi bila picha" : ""}.` });
          break;
        }
        const plain = [parsed.title, ...parsed.bullets.map((b) => `• ${b}`)].join("\n");
        const annRef = { ...(c.media ? { message_id: c.messageId, chat_id: c.chatId, media: c.media } : {}), announce: { html, details: parsed.details } };
        const annRow = (member_id: string) => ({
          member_id, sender_label: "📢 Tangazo", kind: (c.media === "photo" ? "image" : "text") as "image" | "text", body: plain, reply_to_id: null,
          telegram_chat_message_ref: annRef as never,
          source_update_id: update.update_id, moderation_status: "pending" as const,
          publication_status: "unpublished" as const, processing_status: "awaiting_moderation" as const,
        });
        const { data: mem } = await db.from("members").select("id").eq("telegram_user_id", c.userId).maybeSingle();
        const upsertOpts = { onConflict: "source_update_id", ignoreDuplicates: true };
        let ins = await db.from("messages").upsert(annRow(null as unknown as string), upsertOpts);
        if (ins.error && mem) ins = await db.from("messages").upsert(annRow(mem.id), upsertOpts);
        if (ins.error) throw ins.error;
        const { data: annMsg, error: annErr } = await db.from("messages").select("id").eq("source_update_id", update.update_id).single();
        if (annErr) throw annErr;
        // Tangazo la awali lililobandikwa litaondolewa pin tangazo jipya likibandikwa.
        const { data: prevAnn } = await db.from("messages").select("id")
          .eq("processing_status", "published")
          .filter("telegram_chat_message_ref->>announce", "not.is", null)
          .neq("id", annMsg.id)
          .order("created_at", { ascending: false }).limit(1).maybeSingle();
        await publishMessage(annMsg.id);
        if (prevAnn) await pinEverywhere(prevAnn.id, "unpin", false);
        const res = await pinEverywhere(annMsg.id, "pin", false);
        await tg("sendMessage", { chat_id: c.chatId, text: `📢 Tangazo limetumwa na kubandikwa kwa chat ${res.done} kati ya ${res.total}.${prevAnn ? " Tangazo la awali limeondolewa kwenye pin." : ""} Kuliondoa, jibu tangazo kisha andika /unpin.` });
        break;
      }
      case "announce_details": {
        const answer = (text?: string, alert = false) => tg("answerCallbackQuery", { callback_query_id: c.callbackId, ...(text ? { text, show_alert: alert } : {}) }).catch(() => {});
        const { data: mem } = await db.from("members").select("id").eq("telegram_user_id", c.userId).maybeSingle();
        if (!mem) { await answer("Tuma /start kwanza."); status = "ignored"; break; }
        const { data: target } = await db.from("telegram_deliveries").select("message_id").eq("member_id", mem.id).eq("telegram_message_id", c.messageId).eq("status", "sent").maybeSingle();
        if (!target) { await answer("Maelezo hayapatikani."); status = "ignored"; break; }
        const { data: message, error: messageError } = await db.from("messages").select("telegram_chat_message_ref").eq("id", target.message_id).single();
        if (messageError) throw messageError;
        const ann = announceOf(message.telegram_chat_message_ref);
        if (!ann || !ann.details) { await answer("Hakuna maelezo zaidi."); status = "ignored"; break; }
        if (ann.details.length <= 190) {
          await answer(ann.details, true);
        } else {
          await answer();
          await tg("sendMessage", {
            chat_id: c.chatId, parse_mode: "HTML",
            text: `📋 <b>Maelezo kamili</b>\n\n${escapeHtml(ann.details.slice(0, 3800))}`,
            reply_parameters: { message_id: c.messageId, allow_sending_without_reply: true },
          });
        }
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
        const [{ data: policyRow }, { data: termRows, error: termError }, nick, gender] = await Promise.all([
          db.from("system_settings").select("value").eq("key", "content_policy").maybeSingle(),
          db.from("blocked_terms").select("term"),
          nickOfUser(c.userId),
          genderOfUser(c.userId),
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
            updateId: update.update_id, memberId: mem.id, senderLabel: label, senderNick: nick, senderGender: gender, chatId: c.chatId, messageId: c.messageId,
            media, text: c.text, entities: c.entities, to: route,
          });
          await touch();
          break;
        }
        const { error } = await db.from("messages").upsert({
          member_id: mem.id, sender_label: label, kind: media === "photo" ? "image" : "text", body: c.text || null,
          reply_to_id: null, telegram_chat_message_ref: { message_id: c.messageId, chat_id: c.chatId, media, entities: c.entities, ...(nick ? { nick } : {}), ...(gender ? { g: gender } : {}) },
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
  const announce = announceOf(src.telegram_chat_message_ref);
  const [policy, notice, blocked, silent] = await Promise.all([votePolicy(), noticeFor(src), likelyBlockedChats(messageId), silentChats(), waitForEarlier(src.source_update_id)]);
  const markup = announce
    ? (announce.details ? { reply_markup: { inline_keyboard: [[{ text: "📋 View Details", callback_data: "a:d" }]] } } : {})
    : poll
      ? { reply_markup: pollKeyboard(poll.options.length) }
      : votesEnabled(policy, ref?.media) ? { reply_markup: voteKeyboard() } : {};

  const claim = () => db.rpc("claim_private_deliveries_v2", { _message_id: messageId });
  type Claimed = NonNullable<Awaited<ReturnType<typeof claim>>["data"]>[number];
  const gate = rateGate(28);
  let temporaryFailure = false;

  const sendRow = async (row: Claimed) => {
    let patch: { status: string; sent_at?: string; telegram_message_id?: number; last_error: string | null };
    if (blocked.has(row.chat_id)) {
      patch = { status: "unreachable", last_error: "skipped: bot blocked by user (recent)" };
    } else {
      try {
        await gate();
        const rowNotice = notice(row.chat_id);
        const shownLabel = labelWithNick(row.sender_label, src.telegram_chat_message_ref);
        // Hali ya kimya: ujumbe wa kawaida tu (ukijibiwa/ukitajwa, tangazo au poll bado vinaleta arifa).
        const quiet = !announce && !poll && !rowNotice && silent.has(row.chat_id) ? { disable_notification: true } : {};
        const sent = ref
          ? await tg<{ message_id: number }>("copyMessage", {
              chat_id: row.chat_id, from_chat_id: ref.chat_id, message_id: ref.message_id,
              ...(ref.media === "sticker" ? {} : { parse_mode: "HTML", caption: announce ? announce.html : buildMessageHtml({ ...row, sender_label: shownLabel, entities, notice: rowNotice }, !row.reply_message_id, 900) }),
              ...(!announce && row.reply_message_id ? { reply_parameters: { message_id: row.reply_message_id, allow_sending_without_reply: true } } : {}),
              ...markup,
              ...quiet,
            })
          : await tg<{ message_id: number }>("sendMessage", announce
              ? { chat_id: row.chat_id, parse_mode: "HTML", text: announce.html, ...markup }
              : { ...telegramMessagePayload({ ...row, sender_label: shownLabel, entities, notice: rowNotice }), ...markup, ...quiet });
        patch = { status: "sent", sent_at: new Date().toISOString(), telegram_message_id: sent.message_id, last_error: null };
      } catch (e) {
        const permanent = e instanceof TelegramError && (e.status === 403 || e.status === 400);
        if (!permanent) temporaryFailure = true;
        patch = { status: permanent ? "unreachable" : "failed", last_error: e instanceof Error ? e.message.slice(0, 500) : "error" };
      }
    }
    const { error: saveError } = await db.from("telegram_deliveries").update(patch).eq("id", row.id);
    if (saveError) throw saveError;
  };

  const startedAt = Date.now();
  // Awamu 1: anza kutuma huku bado unachukua wapokeaji wengine (kinga: usitume safu moja mara mbili).
  const seen = new Set<string>();
  const inflight: Promise<void>[] = [];
  for (let i = 0; i < 40 && Date.now() - startedAt < 15_000; i++) {
    const { data: rows, error: claimError } = await claim();
    if (claimError) throw claimError;
    const fresh = (rows ?? []).filter((r) => !seen.has(String(r.id)));
    if (!fresh.length) break;
    for (const r of fresh) seen.add(String(r.id));
    inflight.push(...fresh.map(sendRow));
  }
  await Promise.all(inflight);
  // Awamu 2: jaribu tena zilizoshindwa kwa muda mfupi.
  for (let attempt = 0; attempt < 6 && Date.now() - startedAt < 25_000; attempt++) {
    const { data: rows, error: claimError } = await claim();
    if (claimError) throw claimError;
    if (!rows?.length) break;
    temporaryFailure = false;
    await Promise.all(rows.map(sendRow));
    if (temporaryFailure) await sleep(1000);
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
  // Matangazo yana muundo wake maalum; ujumbe ulioondolewa hauhaririwi tena.
  if (announceOf(msg.telegram_chat_message_ref)) return;
  if (removedOf(msg.telegram_chat_message_ref)) return;
  let reply: { reply_label: string; reply_body: string | null } | undefined;
  if (msg.reply_to_id) {
    const { data: parent } = await db.from("messages").select("sender_label, body").eq("id", msg.reply_to_id).maybeSingle();
    if (parent) reply = { reply_label: parent.sender_label, reply_body: parent.body };
  }
  const ref = mediaRef(msg.telegram_chat_message_ref);
  const entities = entitiesOf(msg.telegram_chat_message_ref);
  const poll = pollOf(msg.telegram_chat_message_ref);
  // Kuficha kwa jamii: ❌/👎 nyingi na angalau mara mbili ya ✅/👍.
  const tally = (emojis: string[]) => (summary ?? []).filter((r) => emojis.includes(r.emoji)).reduce((a, r) => a + Number(r.total), 0);
  const down = tally(["❌", "👎"]);
  const up = tally(["✅", "👍"]);
  if (!poll && down >= COMMUNITY_HIDE_VOTES && down >= up * 2) {
    await removeEverywhere(messageId, msg.telegram_chat_message_ref, "community", down);
    return;
  }
  const sticker = ref?.media === "sticker";
  const reply_markup = poll
    ? (poll.closed ? { inline_keyboard: [] } : pollKeyboard(poll.options.length, summary ?? []))
    : votesEnabled(await votePolicy(), ref?.media) ? voteKeyboard(summary ?? []) : { inline_keyboard: [] };
  const notice = await noticeFor({ body: msg.body, reply_to_id: msg.reply_to_id });
  const footerCounts = poll ? [] : (summary ?? []).filter((r) => r.emoji !== "✅" && r.emoji !== "❌");
  const resultsText = poll?.closed
    ? `\n\n🔒 <b>Kura zimefungwa. Matokeo:</b>\n${poll.options.map((o, i) => `${POLL_EMOJIS[i]} ${escapeHtml(o)}: <b>${Number((summary ?? []).find((s) => s.emoji === POLL_EMOJIS[i])?.total ?? 0)}</b>`).join("\n")}`
    : "";
  const shownLabel = labelWithNick(msg.sender_label, msg.telegram_chat_message_ref);
  const textFor = (chatId: number) => {
    const row = { sender_label: shownLabel, body: msg.body, entities, notice: notice(chatId), ...reply };
    return withReactionFooter(ref ? buildMessageHtml(row, true, 900) : telegramStoredMessageText(row), footerCounts) + resultsText;
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

// ---- Majibu ya siri (Reply = ujumbe kwa mwenye ujumbe aliyejibiwa pekee) ----

const PRIVATE_NOTICE = "🔒 <b>Jibu la siri</b>\n";

type ReplyRoute =
  | { kind: "public" }
  | { kind: "unknown" }
  | { kind: "private"; parentId: string; authorChat: number; authorLabel: string; parentMsg: { chat_id: number; message_id: number } };

/**
 * Hutambua mwenye ujumbe uliojibiwa.
 * - nakala ya ujumbe wa wazi, au nakala ya jibu la siri lililotumwa kwa mtu huyu → "private" kwa mwenye ujumbe huo
 * - ujumbe wake mwenyewe → "public"
 * - vinginevyo → "unknown" (hatutumi, ili jibu la siri lisitoke hadharani kimakosa)
 */
async function resolveReplyRoute(memberId: string, chatId: number, replyMessageId: number): Promise<ReplyRoute> {
  const db = await admin();
  const { data: parentId, error } = await db.rpc("resolve_telegram_reply", { _member_id: memberId, _telegram_message_id: replyMessageId });
  if (error) throw error;
  let row: { id: string; sender_label: string; telegram_chat_message_ref: unknown } | null = null;
  if (parentId) {
    const { data } = await db.from("messages").select("id, sender_label, telegram_chat_message_ref").eq("id", parentId).maybeSingle();
    row = data;
  } else {
    const { data } = await db.from("messages").select("id, sender_label, telegram_chat_message_ref")
      .filter("telegram_chat_message_ref->private->>copy_id", "eq", String(replyMessageId))
      .filter("telegram_chat_message_ref->private->>to_chat", "eq", String(chatId))
      .limit(1).maybeSingle();
    row = data;
  }
  if (!row) {
    const { data: own } = await db.from("messages").select("id")
      .filter("telegram_chat_message_ref->>message_id", "eq", String(replyMessageId))
      .filter("telegram_chat_message_ref->>chat_id", "eq", String(chatId))
      .limit(1).maybeSingle();
    return own ? { kind: "public" } : { kind: "unknown" };
  }
  const parent = origRef(row.telegram_chat_message_ref);
  if (!parent) return { kind: "unknown" };
  if (parent.chat_id === chatId) return { kind: "public" };
  return { kind: "private", parentId: row.id, authorChat: parent.chat_id, authorLabel: labelWithNick(row.sender_label, row.telegram_chat_message_ref), parentMsg: parent };
}

/** Hutuma jibu la siri moja kwa moja kwa mwenye ujumbe (bila kupitia usambazaji kwa wote). */
async function sendPrivateReply(args: {
  updateId: number; memberId: string; senderLabel: string; senderNick: string | null; senderGender: Gender | null; chatId: number; messageId: number;
  media: string | null; text: string; entities: TgEntity[]; to: Extract<ReplyRoute, { kind: "private" }>;
}) {
  const db = await admin();
  const failToSender = (text: string) => tg("sendMessage", { chat_id: args.chatId, text, reply_parameters: { message_id: args.messageId, allow_sending_without_reply: true } }).catch(() => {});

  const { data: target } = await db.from("members").select("status").eq("telegram_user_id", args.to.authorChat).maybeSingle();
  if (!target || target.status !== "active") {
    await failToSender("⚠️ Jibu halijatumwa: mpokeaji hapatikani kwa sasa.");
    return;
  }

  const shownSender = labelWithNick(args.senderLabel, { nick: args.senderNick, g: args.senderGender });
  const refBase = { message_id: args.messageId, chat_id: args.chatId, media: args.media, entities: args.entities, ...(args.senderNick ? { nick: args.senderNick } : {}), ...(args.senderGender ? { g: args.senderGender } : {}) };
  const { error: upsertError } = await db.from("messages").upsert({
    member_id: args.memberId, sender_label: args.senderLabel, kind: args.media === "photo" ? "image" : "text", body: args.text || null,
    reply_to_id: args.to.parentId,
    telegram_chat_message_ref: { ...refBase, private: { to_chat: args.to.authorChat, copy_id: null } },
    source_update_id: args.updateId, moderation_status: "pending",
    publication_status: "unpublished", processing_status: "published",
  }, { onConflict: "source_update_id", ignoreDuplicates: true });
  if (upsertError) throw upsertError;

  const { data: row, error: rowError } = await db.from("messages").select("id, telegram_chat_message_ref").eq("source_update_id", args.updateId).single();
  if (rowError) throw rowError;
  // Kinga: usitume mara mbili Telegram ikirudia sasisho.
  if ((row.telegram_chat_message_ref as { private?: { copy_id?: number | null } } | null)?.private?.copy_id) return;

  const html = buildMessageHtml(
    { sender_label: shownSender, body: args.text || null, entities: args.entities, notice: PRIVATE_NOTICE },
    false, args.media ? 900 : 4000,
  );
  const reply = { reply_parameters: { message_id: args.to.parentMsg.message_id, allow_sending_without_reply: true } };
  let sent: { message_id: number };
  try {
    if (args.media === "sticker") {
      await tg("sendMessage", { chat_id: args.to.authorChat, parse_mode: "HTML", text: `${PRIVATE_NOTICE}<blockquote>${escapeHtml(shownSender)}</blockquote>`, ...reply });
      sent = await tg<{ message_id: number }>("copyMessage", { chat_id: args.to.authorChat, from_chat_id: args.chatId, message_id: args.messageId });
    } else if (args.media) {
      sent = await tg<{ message_id: number }>("copyMessage", { chat_id: args.to.authorChat, from_chat_id: args.chatId, message_id: args.messageId, parse_mode: "HTML", caption: html, ...reply });
    } else {
      sent = await tg<{ message_id: number }>("sendMessage", { chat_id: args.to.authorChat, parse_mode: "HTML", text: html, ...reply });
    }
  } catch (e) {
    if (e instanceof TelegramError && (e.status === 403 || e.status === 400)) {
      log("warn", "private_reply_failed", { error: e.message });
      await failToSender(e.status === 403 ? "⚠️ Jibu halijatumwa: mpokeaji hapatikani kwa sasa." : "⚠️ Jibu halijatumwa. Jaribu tena.");
      return;
    }
    throw e;
  }

  const { error: saveError } = await db.from("messages")
    .update({ telegram_chat_message_ref: { ...refBase, private: { to_chat: args.to.authorChat, copy_id: sent.message_id } } as never })
    .eq("id", row.id);
  if (saveError) throw saveError;

  // Uthibitisho mmoja unaosogea: futa wa awali wa mtumaji huyu, kisha tuma mpya chini ya mazungumzo.
  const { data: prev } = await db.from("messages").select("telegram_chat_message_ref")
    .eq("member_id", args.memberId)
    .filter("telegram_chat_message_ref->private->>confirm_id", "not.is", null)
    .neq("id", row.id)
    .order("created_at", { ascending: false }).limit(1).maybeSingle();
  const prevConfirm = (prev?.telegram_chat_message_ref as { private?: { confirm_id?: number | null } } | null)?.private?.confirm_id;
  if (prevConfirm) await tg("deleteMessage", { chat_id: args.chatId, message_id: prevConfirm }).catch(() => {});

  const confirm = await tg<{ message_id: number }>("sendMessage", {
    chat_id: args.chatId, parse_mode: "HTML", disable_notification: true,
    text: `🔒 Imetumwa kwa <b>${escapeHtml(args.to.authorLabel)}</b> pekee.`,
    reply_parameters: { message_id: args.messageId, allow_sending_without_reply: true },
  }).catch(() => null);
  if (confirm) {
    await db.from("messages")
      .update({ telegram_chat_message_ref: { ...refBase, private: { to_chat: args.to.authorChat, copy_id: sent.message_id, confirm_id: confirm.message_id } } as never })
      .eq("id", row.id);
  }
}

// ---- Kuondoa ujumbe (mwandishi, admin, au jamii) ----

/** Idadi ya kura za ❌/👎 zinazofanya ujumbe ufichwe kwa wote (punguza kuwa 2 kwa majaribio). */
const COMMUNITY_HIDE_VOTES = 10;

function removedOf(v: unknown): string | null {
  const r = (v as { removed?: unknown } | null)?.removed;
  return typeof r === "string" ? r : null;
}

/** Hupata ujumbe unaoweza kufutwa: wako mwenyewe, au (kwa admin) wa mtu mwingine kwa kujibu nakala yake. */
async function findDeletable(memberId: string, userId: number, chatId: number, replyMessageId: number): Promise<{ id: string; ref: unknown; reason: "author" | "admin" } | null> {
  const db = await admin();
  const { data: own } = await db.from("messages").select("id, telegram_chat_message_ref")
    .eq("member_id", memberId)
    .filter("telegram_chat_message_ref->>message_id", "eq", String(replyMessageId))
    .filter("telegram_chat_message_ref->>chat_id", "eq", String(chatId))
    .limit(1).maybeSingle();
  if (own) return { id: own.id, ref: own.telegram_chat_message_ref, reason: "author" };
  const { data: slot } = await db.rpc("get_telegram_admin_slot", { _tg_user_id: userId });
  if (!slot) return null;
  const { data: copyOf } = await db.rpc("resolve_telegram_reply", { _member_id: memberId, _telegram_message_id: replyMessageId });
  if (!copyOf) return null;
  const { data: row } = await db.from("messages").select("id, telegram_chat_message_ref").eq("id", copyOf).maybeSingle();
  return row ? { id: row.id, ref: row.telegram_chat_message_ref, reason: "admin" } : null;
}

/**
 * Huondoa ujumbe kwa wote: hufuta nakala zote (au kwa jamii, maandishi hubadilishwa kuwa taarifa ya "umefichwa").
 * Huweka alama ili usionekane tena kwenye /historia na /tafuta.
 */
async function removeEverywhere(messageId: string, ref: unknown, reason: "author" | "admin" | "community", votes = 0) {
  const db = await admin();
  const pv = (ref as { private?: { to_chat?: number; copy_id?: number | null; confirm_id?: number | null } } | null)?.private;
  const media = mediaRef(ref);
  const own = origRef(ref);
  const { error: markError } = await db.from("messages").update({ telegram_chat_message_ref: { ...(ref as Record<string, unknown>), removed: reason } as never }).eq("id", messageId);
  if (markError) log("warn", "remove_mark_failed", { error: markError.message });

  const targets: Array<{ chat_id: number; message_id: number }> = [];
  if (pv?.to_chat && pv.copy_id) {
    targets.push({ chat_id: pv.to_chat, message_id: pv.copy_id });
  } else {
    const { data: deliveries } = await db.from("telegram_deliveries").select("telegram_message_id, members(telegram_user_id)").eq("message_id", messageId).eq("status", "sent");
    for (const d of deliveries ?? []) {
      const chat = (d.members as { telegram_user_id: number } | null)?.telegram_user_id;
      if (chat && d.telegram_message_id) targets.push({ chat_id: chat, message_id: d.telegram_message_id });
    }
  }
  const placeholder = reason === "community" && !media && !pv;
  const hiddenText = `🚫 <i>Ujumbe huu umefichwa na jamii (❌ ${votes}).</i>`;
  let done = 0;
  for (let i = 0; i < targets.length; i += 25) {
    if (i > 0) await sleep(1100);
    const results = await Promise.allSettled(targets.slice(i, i + 25).map((x) => placeholder
      ? tg("editMessageText", { chat_id: x.chat_id, message_id: x.message_id, parse_mode: "HTML", text: hiddenText, reply_markup: { inline_keyboard: [] } })
      : tg("deleteMessage", { chat_id: x.chat_id, message_id: x.message_id })));
    done += results.filter((r) => r.status === "fulfilled").length;
  }
  if (own) {
    if (reason === "author") {
      await tg("deleteMessage", { chat_id: own.chat_id, message_id: own.message_id }).catch(() => {});
      if (pv?.confirm_id) await tg("deleteMessage", { chat_id: own.chat_id, message_id: pv.confirm_id }).catch(() => {});
    } else {
      await tg("sendMessage", {
        chat_id: own.chat_id, disable_notification: true,
        text: reason === "admin" ? "🚫 Ujumbe wako umeondolewa na admin." : "🚫 Ujumbe wako umefichwa na jamii kwa kura nyingi za ❌.",
      }).catch(() => {});
    }
  }
  return { done, total: targets.length };
}

/** Hubandika (pin) au kuondoa pin ya ujumbe kwenye chat ya kila mwanachama. Arifa zimezimwa kwenye chat binafsi. */
async function pinEverywhere(messageId: string, action: "pin" | "unpin", includeOwn = true) {
  const db = await admin();
  const { data: msg, error: msgError } = await db.from("messages").select("telegram_chat_message_ref").eq("id", messageId).single();
  if (msgError) throw msgError;
  const { data: deliveries, error: delError } = await db.from("telegram_deliveries").select("telegram_message_id, members(telegram_user_id)").eq("message_id", messageId).eq("status", "sent");
  if (delError) throw delError;
  const targets: Array<{ chat_id: number; message_id: number }> = [];
  const own = includeOwn ? origRef(msg.telegram_chat_message_ref) : null;
  if (own) targets.push(own);
  for (const d of deliveries ?? []) {
    const chat = (d.members as { telegram_user_id: number } | null)?.telegram_user_id;
    if (chat && d.telegram_message_id) targets.push({ chat_id: chat, message_id: d.telegram_message_id });
  }
  let done = 0;
  for (let i = 0; i < targets.length; i += 25) {
    if (i > 0) await sleep(1100);
    const results = await Promise.allSettled(targets.slice(i, i + 25).map((x) =>
      action === "pin"
        ? tg("pinChatMessage", { chat_id: x.chat_id, message_id: x.message_id, disable_notification: true })
        : tg("unpinChatMessage", { chat_id: x.chat_id, message_id: x.message_id })));
    done += results.filter((r) => r.status === "fulfilled").length;
  }
  return { done, total: targets.length };
}

// ---- Historia, kutafuta na uchunguzi (muda wote ni saa za Afrika Mashariki) ----

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
  return `${time}<b>${escapeHtml(labelWithNick(r.sender_label, r.telegram_chat_message_ref))}</b>: ${parts.join(" · ")}`;
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
    if (i > 0) await sleep(1100);
    await tg("sendMessage", { chat_id: chatId, text: chunks[i]!, parse_mode: "HTML", disable_notification: i > 0 });
  }
}

/** Hutuma ujumbe wa masaa 24 yaliyopita (hadi 100) kama vipande vichache. Majibu ya siri na yaliyoondolewa hayajumuishwi. */
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
      .filter("telegram_chat_message_ref->>private", "is", null)
      .filter("telegram_chat_message_ref->>removed", "is", null)
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

/** /tafuta neno  au  /tafuta @A12 — hurudisha ujumbe 15 wa mwisho unaolingana. Majibu ya siri na yaliyoondolewa hayajumuishwi. */
async function searchMessages(chatId: number, userId: number, query: string) {
  const byLabel = query.startsWith("@");
  const label = byLabel ? query.slice(1).trim() : "";
  if (byLabel ? !/^[A-Za-z0-9]{1,12}$/.test(label) : query.length < 2) {
    await tg("sendMessage", { chat_id: chatId, parse_mode: "HTML", text: "🔎 Andika <code>/tafuta neno</code> kutafuta maneno, au <code>/tafuta @12</code> kuona ujumbe wa utambulisho mmoja." });
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
      .eq("processing_status", "published")
      .filter("telegram_chat_message_ref->>private", "is", null)
      .filter("telegram_chat_message_ref->>removed", "is", null);
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

/** /uchunguzi (admin): ujumbe 5 wa mwisho wa wazi, hali za utumaji na muda wa kufika. */
async function sendDiagnostics(chatId: number) {
  const db = await admin();
  const { data: msgs, error } = await db.from("messages").select("id, created_at").eq("processing_status", "published")
    .filter("telegram_chat_message_ref->>private", "is", null)
    .order("created_at", { ascending: false }).limit(5);
  if (error) throw error;
  if (!msgs?.length) {
    await tg("sendMessage", { chat_id: chatId, text: "Hakuna ujumbe wa kuchunguza bado." });
    return;
  }
  const lines: string[] = [];
  for (const m of msgs) {
    const { data: ds, error: dErr } = await db.from("telegram_deliveries").select("status, sent_at, last_error").eq("message_id", m.id);
    if (dErr) throw dErr;
    const rows = ds ?? [];
    const started = new Date(m.created_at).getTime();
    const lat = rows
      .filter((d) => d.status === "sent" && d.sent_at)
      .map((d) => (new Date(d.sent_at as string).getTime() - started) / 1000)
      .filter((n) => Number.isFinite(n) && n >= 0);
    const count = (s: string) => rows.filter((d) => d.status === s).length;
    const max = lat.length ? Math.max(...lat) : 0;
    const avg = lat.length ? lat.reduce((a, b) => a + b, 0) / lat.length : 0;
    const bad = rows.find((d) => d.last_error)?.last_error?.slice(0, 80);
    const when = new Date(m.created_at);
    lines.push(`<code>${Number.isNaN(when.getTime()) ? "?" : dateTimeFmt.format(when)}</code> ✅${count("sent")} ⏳${count("pending") + count("sending")} ⚠️${count("failed")} 🚫${count("unreachable")} · wastani ${avg.toFixed(1)}s · juu ${max.toFixed(1)}s${bad ? `\n   ${escapeHtml(bad)}` : ""}`);
  }
  await tg("sendMessage", { chat_id: chatId, parse_mode: "HTML", text: `🛠 <b>Ujumbe 5 wa mwisho</b>\n(muda kutoka ujumbe kuingia hadi kufika)\n\n${lines.join("\n")}` });
}
