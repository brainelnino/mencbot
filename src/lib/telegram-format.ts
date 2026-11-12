import type { TgEntity } from "./telegram-parse";

const TAGS = { bold: "b", italic: "i", underline: "u", strikethrough: "s", spoiler: "tg-spoiler", pre: "pre", code: "code" } as const;
const ORDER = Object.keys(TAGS) as Array<keyof typeof TAGS>;

/** Hubadilisha maandishi + entities kuwa HTML salama ya Telegram. */
export function entitiesToHtml(text: string, entities: TgEntity[] = []) {
  const ents = entities
    .filter((e) => ORDER.includes(e.type as keyof typeof TAGS) && e.length > 0 && e.offset < text.length)
    .map((e) => ({ type: e.type, start: e.offset, end: Math.min(e.offset + e.length, text.length) }));
  if (!ents.length) return escapeHtml(text);
  const cuts = [...new Set([0, text.length, ...ents.flatMap((e) => [e.start, e.end])])].sort((a, b) => a - b);
  let html = "";
  for (let i = 0; i < cuts.length - 1; i++) {
    const a = cuts[i]!, b = cuts[i + 1]!;
    const on = ORDER.filter((t) => ents.some((e) => e.type === t && e.start <= a && e.end >= b));
    html += on.map((t) => `<${TAGS[t]}>`).join("") + escapeHtml(text.slice(a, b)) + [...on].reverse().map((t) => `</${TAGS[t]}>`).join("");
  }
  return html;
}

// Telegram HTML is escaped independently from the private delivery references.
export function escapeHtml(text: string) {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

export type TelegramDeliveryContent = {
  chat_id: number;
  sender_label: string;
  body: string | null;
  reply_message_id?: number | null;
  reply_label?: string | null;
  reply_body?: string | null;
entities?: TgEntity[] | null;
};

export function buildMessageHtml(row: { sender_label: string; body: string | null; reply_label?: string | null; reply_body?: string | null; entities?: TgEntity[] | null }, includeFallback: boolean, max = 4000) {
  const fallback = includeFallback && row.reply_label
    ? `<blockquote>↪ ${escapeHtml(row.reply_label)}\n${escapeHtml(Array.from(row.reply_body ?? "").slice(0, 160).join(""))}</blockquote>\n`
    : "";
  // Keep the parsed Telegram text below 4096 characters even with fallback context.
  const body = Array.from(row.body ?? "").slice(0, fallback ? max - 200 : max).join("");
    return `${fallback}<blockquote>${escapeHtml(row.sender_label)}</blockquote>\n${entitiesToHtml(body, row.entities ?? [])}`;
}

export function telegramMessagePayload(row: TelegramDeliveryContent) {
  // The native reply targets a message in THIS recipient's chat, never another chat.
  return {
    chat_id: row.chat_id,
    parse_mode: "HTML",
    text: buildMessageHtml(row, !row.reply_message_id),
    ...(row.reply_message_id ? { reply_parameters: { message_id: row.reply_message_id, allow_sending_without_reply: true } } : {}),
  };
}

/** Text for editing an already-delivered copy: reply context is always a quote (edits cannot carry reply_parameters). */
export function telegramStoredMessageText(row: { sender_label: string; body: string | null; reply_label?: string | null; reply_body?: string | null; entities?: TgEntity[] | null }) {
  return buildMessageHtml(row, true);
}

/** Appends an anonymous aggregate reaction footer, or returns the text unchanged when there are no reactions. */
export function withReactionFooter(text: string, counts: Array<{ emoji: string; total: number | bigint }>) {
  if (!counts.length) return text;
  const footer = `<blockquote>${counts.map((c) => `${c.emoji}×${c.total}`).join("  ")}</blockquote>`;
  return `${text}\n\n${footer}`;
}
export const VOTE_EMOJIS = ["✅", "❌"] as const;

/** Inline ✅/❌ buttons with anonymous aggregate counts. */
export function voteKeyboard(counts: Array<{ emoji: string; total: number | bigint }> = []) {
  return {
    inline_keyboard: [VOTE_EMOJIS.map((e) => {
      const n = Number(counts.find((c) => c.emoji === e)?.total ?? 0);
      return { text: n ? `${e} ${n}` : e, callback_data: `v:${e}` };
    })],
  };
}
