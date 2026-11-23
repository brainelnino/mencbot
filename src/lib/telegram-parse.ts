// Pure helpers for Telegram updates (no I/O) — safe to unit test.
export type TgUpdate = {
  update_id: number;
  message?: {
    message_id: number;
    from?: { id: number; is_bot?: boolean };
    chat: { id: number; type: string; title?: string };
    text?: string;
    photo?: unknown[];
    caption?: string;
    entities?: unknown[];
    caption_entities?: unknown[];
    video?: unknown; document?: unknown; voice?: unknown; audio?: unknown; sticker?: unknown; animation?: unknown; video_note?: unknown;
    forward_origin?: unknown; forward_date?: number;
    reply_to_message?: { message_id: number; text?: string; from?: { id: number; is_bot?: boolean } };
  };
  message_reaction?: {
    message_id: number;
    chat: { id: number; type: string };
    user?: { id: number };
    new_reaction?: Array<{ type: string; emoji?: string }>;
  };
  callback_query?: {
    id: string;
    from: { id: number };
    data?: string;
    message?: { message_id: number; chat: { id: number; type: string } };
  };
  [k: string]: unknown;
};

export type TgEntity = { type: string; offset: number; length: number; unix_time?: number; date_time_format?: string };

/** Maandishi ya mwanzo ya maombi ya bot (hutumika kutambua jibu la mtumiaji kwa ombi hilo). */
export const NAME_PROMPT = "✏️ Andika jina lako jipya";
export const SEARCH_PROMPT = "🔎 Andika neno la kutafuta";

const KEEP = ["bold", "italic", "underline", "strikethrough", "spoiler", "code", "pre", "blockquote", "expandable_blockquote", "date_time"];

/** Huchuja formatting salama tu na kurekebisha offset baada ya trim. */
export function normalizeEntities(list: unknown, lead = 0): TgEntity[] {
  if (!Array.isArray(list)) return [];
  const out: TgEntity[] = [];
  for (const e of list.slice(0, 100)) {
    if (!e || !KEEP.includes(e.type) || !Number.isInteger(e.offset) || !Number.isInteger(e.length)) continue;
    if (e.type === "date_time" && !Number.isInteger(e.unix_time)) continue;
    let offset = e.offset - lead, length = e.length;
    if (offset < 0) { length += offset; offset = 0; }
    if (length <= 0) continue;
    const base = { type: e.type, offset, length };
    if (e.type !== "date_time") { out.push(base); continue; }
    const f = typeof e.date_time_format === "string" && /^(r|w?[dD]?[tT]?)$/.test(e.date_time_format) ? e.date_time_format : undefined;
    out.push({ ...base, unix_time: e.unix_time, ...(f ? { date_time_format: f } : {}) });
  }
  return out;
}

export type Classified =
  | { kind: "start"; userId: number; chatId: number }
  | { kind: "menu"; userId: number; chatId: number; messageId: number | null; callbackId: string | null; action: string }
  | { kind: "gender"; userId: number; chatId: number; messageId: number; callbackId: string; value: "f" | "m" }
  | { kind: "calc"; userId: number; chatId: number; messageId: number; expr: string; auto?: boolean }
  | { kind: "silent_toggle"; userId: number; chatId: number }
  | { kind: "delete_message"; userId: number; chatId: number; messageId: number; replyMessageId: number | null }
  | { kind: "set_name"; userId: number; chatId: number; messageId: number; name: string }
  | { kind: "history"; userId: number; chatId: number; messageId: number | null; callbackId: string | null }
  | { kind: "search"; userId: number; chatId: number; query: string }
  | { kind: "admin_pin"; userId: number; chatId: number; action: "pin" | "unpin"; replyMessageId: number | null }
  | { kind: "admin_poll"; userId: number; chatId: number; action: "create" | "close"; raw: string; replyMessageId: number | null }
  | { kind: "admin_diag"; userId: number; chatId: number }
  | { kind: "admin_announce"; userId: number; chatId: number; messageId: number; media: MediaType | null; raw: string }
  | { kind: "announce_details"; userId: number; chatId: number; messageId: number; callbackId: string }
  | { kind: "unknown_command"; userId: number; chatId: number; messageId: number; command: string }
  | { kind: "poll_vote"; userId: number; chatId: number; messageId: number; option: number; callbackId: string }
  | { kind: "private_text"; userId: number; chatId: number; text: string; entities: TgEntity[]; messageId: number; replyMessageId: number | null }
  | { kind: "private_media"; userId: number; chatId: number; media: MediaType; text: string; entities: TgEntity[]; messageId: number; replyMessageId: number | null }
  | { kind: "private_other"; userId: number; chatId: number }
  | { kind: "admin_command"; userId: number; chatId: number; command: "admin" | "zuia" | "rudisha"; label: string | undefined }
  | { kind: "group_link"; chatId: number; code: string; title: string | null }
  | { kind: "reaction"; userId: number; chatId: number; messageId: number; emoji: string | null }
  | { kind: "vote"; userId: number; chatId: number; messageId: number; emoji: string; callbackId: string }
  | { kind: "ignored"; reason: string };

export type MediaType = "photo" | "video" | "document" | "voice" | "audio" | "sticker" | "animation";

function detectMedia(m: NonNullable<TgUpdate["message"]>): MediaType | null {
  if (m.photo?.length) return "photo";
  if (m.animation) return "animation";
  if (m.video || m.video_note) return "video";
  if (m.document) return "document";
  if (m.voice) return "voice";
  if (m.audio) return "audio";
  if (m.sticker) return "sticker";
  return null;
}

export function classifyUpdate(u: TgUpdate): Classified {
  const cb = u.callback_query;
  if (cb) {
    if (cb.data === "h:24" && cb.message && cb.message.chat.type === "private") {
      return { kind: "history", userId: cb.from.id, chatId: cb.message.chat.id, messageId: cb.message.message_id, callbackId: cb.id };
    }
    if (cb.data === "a:d" && cb.message && cb.message.chat.type === "private") {
      return { kind: "announce_details", userId: cb.from.id, chatId: cb.message.chat.id, messageId: cb.message.message_id, callbackId: cb.id };
    }
    const gm = /^g:(f|m)$/.exec(cb.data ?? "");
    if (gm?.[1] && cb.message && cb.message.chat.type === "private") {
      return { kind: "gender", userId: cb.from.id, chatId: cb.message.chat.id, messageId: cb.message.message_id, callbackId: cb.id, value: gm[1] as "f" | "m" };
    }
    const mm = /^m:(me|name|setname|delname|perm|quiet|hist|search|home)$/.exec(cb.data ?? "");
    if (mm?.[1] && cb.message && cb.message.chat.type === "private") {
      return { kind: "menu", userId: cb.from.id, chatId: cb.message.chat.id, messageId: cb.message.message_id, callbackId: cb.id, action: mm[1] };
    }
    const pv = /^p:([0-3])$/.exec(cb.data ?? "");
    if (pv?.[1] && cb.message && cb.message.chat.type === "private") {
      return { kind: "poll_vote", userId: cb.from.id, chatId: cb.message.chat.id, messageId: cb.message.message_id, option: Number(pv[1]), callbackId: cb.id };
    }
    const v = /^v:(✅|❌)$/.exec(cb.data ?? "");
    if (!v?.[1] || !cb.message || cb.message.chat.type !== "private") return { kind: "ignored", reason: "callback_scope" };
    return { kind: "vote", userId: cb.from.id, chatId: cb.message.chat.id, messageId: cb.message.message_id, emoji: v[1], callbackId: cb.id };
  }
  const r = u.message_reaction;
  if (r) {
    if (r.chat?.type !== "private" || !r.user) return { kind: "ignored", reason: "reaction_scope" };
    const emoji = r.new_reaction?.find((x) => x.type === "emoji")?.emoji ?? null;
    return { kind: "reaction", userId: r.user.id, chatId: r.chat.id, messageId: r.message_id, emoji };
  }
  const m = u.message;
  if (!m || !m.chat) return { kind: "ignored", reason: "no_message" };
  if (m.from?.is_bot) return { kind: "ignored", reason: "from_bot" };
  const raw = m.text ?? "";
  const text = raw.trim();
  if (m.chat.type === "private") {
    if (!m.from) return { kind: "ignored", reason: "no_sender" };
    if (/^\/start(@\w+)?(\s|$)/.test(text)) return { kind: "start", userId: m.from.id, chatId: m.chat.id };
    if (/^\/(menu|menyu)(?:@\w+)?\s*$/i.test(text)) return { kind: "menu", userId: m.from.id, chatId: m.chat.id, messageId: null, callbackId: null, action: "open" };
    // Kikokotoo: /hesabu 25*4 au "= 25*4". Jibu ni la mtumaji pekee, halisambazwi.
    const calc = /^\/(hesabu|calc)(?:@\w+)?(?:\s+([\s\S]*))?$/i.exec(text) ?? /^=\s*(?=[\s\S]*\d)([\s\S]+)$/.exec(text);
    if (calc) return { kind: "calc", userId: m.from.id, chatId: m.chat.id, messageId: m.message_id, expr: (calc[2] ?? (/^=/.test(text) ? calc[1] : "") ?? "").trim().slice(0, 200) };
    if (/^\/(kimya|silent)(?:@\w+)?\s*$/i.test(text)) return { kind: "silent_toggle", userId: m.from.id, chatId: m.chat.id };
    if (/^\/(futa|delete)(?:@\w+)?\s*$/i.test(text)) return { kind: "delete_message", userId: m.from.id, chatId: m.chat.id, messageId: m.message_id, replyMessageId: m.reply_to_message?.message_id ?? null };
    if (/^\/(historia|history)(@\w+)?\s*$/i.test(text)) return { kind: "history", userId: m.from.id, chatId: m.chat.id, messageId: null, callbackId: null };
    const sq = /^\/(tafuta|search)(?:@\w+)?(?:\s+([\s\S]+))?$/i.exec(text);
    if (sq) return { kind: "search", userId: m.from.id, chatId: m.chat.id, query: (sq[2] ?? "").trim().slice(0, 100) };
    const pin = /^\/(pin|unpin)(?:@\w+)?\s*$/i.exec(text);
    if (pin?.[1]) return { kind: "admin_pin", userId: m.from.id, chatId: m.chat.id, action: pin[1].toLowerCase() as "pin" | "unpin", replyMessageId: m.reply_to_message?.message_id ?? null };
    if (/^\/pollfunga(?:@\w+)?\s*$/i.test(text)) return { kind: "admin_poll", userId: m.from.id, chatId: m.chat.id, action: "close", raw: "", replyMessageId: m.reply_to_message?.message_id ?? null };
    const pl = /^\/poll(?:@\w+)?(?:\s+([\s\S]*))?$/i.exec(text);
    if (pl) return { kind: "admin_poll", userId: m.from.id, chatId: m.chat.id, action: "create", raw: (pl[1] ?? "").trim().slice(0, 600), replyMessageId: null };
    if (/^\/(uchunguzi|diag)(?:@\w+)?\s*$/i.test(text)) return { kind: "admin_diag", userId: m.from.id, chatId: m.chat.id };
    const an = /^\/tangazo(?:@\w+)?(?:\s+([\s\S]*))?$/i.exec(text);
    if (an) return { kind: "admin_announce", userId: m.from.id, chatId: m.chat.id, messageId: m.message_id, media: null, raw: (an[1] ?? "").trim().slice(0, 4000) };
    const cmd = /^\/(admin|zuia|rudisha)(?:@\w+)?(?:\s+([A-Za-z]|[0-9]+))?$/.exec(text);
    if (cmd) return { kind: "admin_command", userId: m.from.id, chatId: m.chat.id, command: cmd[1] as "admin" | "zuia" | "rudisha", label: cmd[2]?.toUpperCase() };
    // Jibu la mtumiaji kwa ombi la bot (jina jipya, neno la kutafuta).
    const rp = m.reply_to_message;
    if (text && rp?.from?.is_bot && typeof rp.text === "string") {
      if (rp.text.startsWith(NAME_PROMPT)) return { kind: "set_name", userId: m.from.id, chatId: m.chat.id, messageId: m.message_id, name: text.slice(0, 60) };
      if (rp.text.startsWith(SEARCH_PROMPT)) return { kind: "search", userId: m.from.id, chatId: m.chat.id, query: text.slice(0, 100) };
    }
    // Ujumbe unaoanza na /neno lisilojulikana: haupaswi kusambazwa kwa wengine.
    const unk = /^\/([A-Za-z0-9_]{1,32})(?:@\w+)?(?:\s|$)/.exec(text);
    if (unk?.[1]) return { kind: "unknown_command", userId: m.from.id, chatId: m.chat.id, messageId: m.message_id, command: unk[1] };
    // Hesabu pekee (tarakimu na alama tu), bila Reply wala forward: jibu la siri kwa mtumaji, halisambazwi.
    if (text && !m.reply_to_message && !m.forward_origin && !m.forward_date && looksLikeMath(text)) {
      return { kind: "calc", userId: m.from.id, chatId: m.chat.id, messageId: m.message_id, expr: text.slice(0, 200), auto: true };
    }
    if (text) return { kind: "private_text", userId: m.from.id, chatId: m.chat.id, text: text.slice(0, 4000), entities: normalizeEntities(m.entities, raw.length - raw.trimStart().length), messageId: m.message_id, replyMessageId: m.reply_to_message?.message_id ?? null };
    const media = detectMedia(m);
    if (media) {
      const cap = m.caption ?? "";
      const ac = /^\s*\/tangazo(?:@\w+)?(?:\s+([\s\S]*))?$/i.exec(cap);
      if (ac) return { kind: "admin_announce", userId: m.from.id, chatId: m.chat.id, messageId: m.message_id, media, raw: (ac[1] ?? "").trim().slice(0, 1024) };
      const uc = /^\s*\/([A-Za-z0-9_]{1,32})(?:@\w+)?(?:\s|$)/.exec(cap);
      if (uc?.[1]) return { kind: "unknown_command", userId: m.from.id, chatId: m.chat.id, messageId: m.message_id, command: uc[1] };
      return { kind: "private_media", userId: m.from.id, chatId: m.chat.id, media, text: cap.trim().slice(0, 1000), entities: normalizeEntities(m.caption_entities, cap.length - cap.trimStart().length), messageId: m.message_id, replyMessageId: m.reply_to_message?.message_id ?? null };
    }
    return { kind: "private_other", userId: m.from.id, chatId: m.chat.id };
  }
  if (m.chat.type === "group" || m.chat.type === "supergroup") {
    const g = /^\/unganisha(@\w+)?\s+([A-Z0-9]{6,12})$/.exec(text);
    if (g?.[2]) return { kind: "group_link", chatId: m.chat.id, code: g[2], title: m.chat.title ?? null };
    return { kind: "ignored", reason: "group_message" };
  }
  return { kind: "ignored", reason: "unsupported_chat" };
}

/** Derived webhook secret: same value at registration and verification, never stored. */
export async function deriveWebhookSecret(connectionKey: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(`telegram-webhook:${connectionKey}`));
  let s = "";
  for (const b of new Uint8Array(buf)) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function safeEqual(a: string, b: string) {
  if (a.length !== b.length) return false;
  let r = 0;
  for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return r === 0;
}

/** Map an editor-preview host to the public stable dev host Telegram can reach. */
export function publicWebhookUrl(origin: string) {
  const u = new URL(origin);
  const m = /^id-preview--([0-9a-f-]+)\.(.+)$/.exec(u.host);
  const host = m ? `project--${m[1]}-dev.${m[2]}` : u.host;
  return `https://${host}/api/public/telegram/webhook`;
}

export function hasLink(text: string): boolean {
  return /(https?:\/\/|www\.|t\.me\/|wa\.me\/|\b[a-z0-9-]+\.(com|net|org|tz|co|io|me|info|biz|app|xyz|link|ly|gl|site|online|africa|ke|ug)\b)/i.test(text);
}

/**
 * @username ya Telegram (herufi ya kwanza, kisha herufi/namba/_ jumla 5–32).
 * Tag za utambulisho (@12, @A, @B7) ni fupi au zinaanza na namba, kwa hiyo hazizuiwi.
 */
export function hasUsername(text: string): boolean {
  return /(^|[^\w@])@[A-Za-z][A-Za-z0-9_]{4,31}(?![A-Za-z0-9_])/.test(text);
}

export function hasPhone(text: string): boolean {
  // 7+ digits allowing spaces, dashes, dots, brackets, optional leading +
  for (const m of text.match(/(\+?\d[\d\s().-]{5,}\d)/g) ?? []) if (m.replace(/\D/g, "").length >= 7) return true;
  return false;
}

/** True when text contains a link or a phone number (any country format). */
export function hasBlockedContent(text: string): boolean {
  return hasLink(text) || hasPhone(text);
}

/**
 * Kikokotoo salama (hakuna eval): + - * / ^ % na mabano; x na × ni kuzidisha, ÷ ni kugawa.
 * "200+10%" = 220 (asilimia ya kushoto). Hurudisha null ikiwa usemi si sahihi au jibu si namba.
 */
export function calculate(input: string): number | null {
  const src = input.replace(/[\s,]/g, "").replace(/[x×]/gi, "*").replace(/÷/g, "/");
  if (!src || src.length > 100 || !/^[0-9+\-*/^%().]+$/.test(src)) return null;
  type V = { v: number; pct: boolean };
  let i = 0;
  const bad = (): never => { throw new Error("bad"); };
  const primary = (): V => {
    if (src[i] === "(") {
      i++;
      const r = expr();
      if (src[i] !== ")") bad();
      i++;
      return { v: r.v, pct: false };
    }
    const m = /^(\d+\.?\d*|\.\d+)/.exec(src.slice(i));
    if (!m) return bad();
    i += m[0].length;
    return { v: Number(m[0]), pct: false };
  };
  const postfix = (): V => {
    let a = primary();
    while (src[i] === "%") { i++; a = { v: a.v / 100, pct: true }; }
    return a;
  };
  const unary = (): V => {
    if (src[i] === "-") { i++; const a = unary(); return { v: -a.v, pct: a.pct }; }
    if (src[i] === "+") { i++; return unary(); }
    return postfix();
  };
  const power = (): V => {
    const base = unary();
    if (src[i] !== "^") return base;
    i++;
    const e = power();
    if (Math.abs(e.v) > 1000) bad();
    return { v: base.v ** e.v, pct: false };
  };
  const term = (): V => {
    let a = power();
    while (src[i] === "*" || src[i] === "/") {
      const op = src[i++];
      const b = power();
      a = { v: op === "*" ? a.v * b.v : a.v / b.v, pct: false };
    }
    return a;
  };
  const expr = (): V => {
    let a = term();
    while (src[i] === "+" || src[i] === "-") {
      const op = src[i++];
      const b = term();
      const delta = b.pct ? a.v * b.v : b.v;
      a = { v: op === "+" ? a.v + delta : a.v - delta, pct: false };
    }
    return a;
  };
  try {
    const r = expr();
    if (i !== src.length || !Number.isFinite(r.v)) return null;
    return r.v;
  } catch {
    return null;
  }
}

/**
 * Utambuzi wa hesabu pekee (bila amri): ujumbe una tarakimu na alama za hesabu tu,
 * na angalau operesheni moja kati ya namba. Herufi yoyote (hata "x") = ujumbe wa kawaida.
 * Tarehe, namba za simu, namba pekee (123) na usemi usio sahihi (5+) si hesabu.
 */
export function looksLikeMath(text: string): boolean {
  const t = text.trim();
  if (!t || t.length > 100 || /\n/.test(t)) return false;
  if (!/^[\d\s+\-*/×÷^%().,]+$/.test(t)) return false;
  if (!/[\d)%]\s*[+\-*/×÷^]\s*[\d(.+\-]/.test(t)) return false;
  if (/^\d{1,4}[-/.]\d{1,2}[-/.]\d{1,4}$/.test(t)) return false;
  if (/^\+[\d\s-]+$/.test(t) || /^0[\d\s-]{8,}$/.test(t)) return false;
  return calculate(t) !== null;
}

/** Returns the first blocked term found in text (whole-word, case-insensitive), or null. */
export function findBlockedTerm(text: string, terms: string[]): string | null {
  const lower = text.toLowerCase();
  for (const raw of terms) {
    const term = raw.trim().toLowerCase();
    if (!term) continue;
    const escaped = term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const re = new RegExp(`(?<![\\p{L}\\p{N}])${escaped}(?![\\p{L}\\p{N}])`, "iu");
    if (re.test(lower)) return raw;
  }
  return null;
}
