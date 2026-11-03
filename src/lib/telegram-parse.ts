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
    video?: unknown; document?: unknown; voice?: unknown; audio?: unknown; sticker?: unknown; animation?: unknown; video_note?: unknown;
    reply_to_message?: { message_id: number };
  };
  message_reaction?: {
    message_id: number;
    chat: { id: number; type: string };
    user?: { id: number };
    new_reaction?: Array<{ type: string; emoji?: string }>;
  };
  [k: string]: unknown;
};

export type Classified =
  | { kind: "start"; userId: number; chatId: number }
  | { kind: "private_text"; userId: number; chatId: number; text: string; messageId: number; replyMessageId: number | null }
  | { kind: "private_media"; userId: number; chatId: number; media: MediaType; text: string; messageId: number; replyMessageId: number | null }
  | { kind: "private_other"; userId: number; chatId: number }
  | { kind: "admin_command"; userId: number; chatId: number; command: "admin" | "zuia" | "rudisha"; label: string | undefined }
  | { kind: "group_link"; chatId: number; code: string; title: string | null }
  | { kind: "reaction"; userId: number; chatId: number; messageId: number; emoji: string | null }
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
  const r = u.message_reaction;
  if (r) {
    if (r.chat?.type !== "private" || !r.user) return { kind: "ignored", reason: "reaction_scope" };
    const emoji = r.new_reaction?.find((x) => x.type === "emoji")?.emoji ?? null;
    return { kind: "reaction", userId: r.user.id, chatId: r.chat.id, messageId: r.message_id, emoji };
  }
  const m = u.message;
  if (!m || !m.chat) return { kind: "ignored", reason: "no_message" };
  if (m.from?.is_bot) return { kind: "ignored", reason: "from_bot" };
  const text = (m.text ?? "").trim();
  if (m.chat.type === "private") {
    if (!m.from) return { kind: "ignored", reason: "no_sender" };
    if (/^\/start(@\w+)?(\s|$)/.test(text)) return { kind: "start", userId: m.from.id, chatId: m.chat.id };
    const cmd = /^\/(admin|zuia|rudisha)(?:@\w+)?(?:\s+([A-Za-z]|[0-9]+))?$/.exec(text);
    if (cmd) return { kind: "admin_command", userId: m.from.id, chatId: m.chat.id, command: cmd[1] as "admin" | "zuia" | "rudisha", label: cmd[2]?.toUpperCase() };
    if (text) return { kind: "private_text", userId: m.from.id, chatId: m.chat.id, text: text.slice(0, 4000), messageId: m.message_id, replyMessageId: m.reply_to_message?.message_id ?? null };
    const media = detectMedia(m);
    if (media) return { kind: "private_media", userId: m.from.id, chatId: m.chat.id, media, text: (m.caption ?? "").trim().slice(0, 1000), messageId: m.message_id, replyMessageId: m.reply_to_message?.message_id ?? null };
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
