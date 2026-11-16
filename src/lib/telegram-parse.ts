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
    reply_to_message?: { message_id: number };
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
  | { kind: "set_display_name"; userId: number; chatId: number; displayName: string }
  | { kind: "identity"; userId: number; chatId: number }
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
    // Ujumbe unaoanza na /neno lisilojulikana: haupaswi kusambazwa kwa wengine.
    const unk = /^\/([A-Za-z0-9_]{1,32})(?:@\w+)?(?:\s|$)/.exec(text);
    if (unk?.[1]) return { kind: "unknown_command", userId: m.from.id, chatId: m.chat.id, messageId: m.message_id, command: unk[1] };
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

export function hasPhone(text: string): boolean {
  // 7+ digits allowing spaces, dashes, dots, brackets, optional leading +
  for (const m of text.match(/(\+?\d[\d\s().-]{5,}\d)/g) ?? []) if (m.replace(/\D/g, "").length >= 7) return true;
  return false;
}

/** True when text contains a link or a phone number (any country format). */
export function hasBlockedContent(text: string): boolean {
  return hasLink(text) || hasPhone(text);
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