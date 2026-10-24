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
};

function buildText(row: { sender_label: string; body: string | null; reply_label?: string | null; reply_body?: string | null }, includeFallback: boolean) {
  const fallback = includeFallback && row.reply_label
    ? `<blockquote>↪ ${escapeHtml(row.reply_label)}\n${escapeHtml(Array.from(row.reply_body ?? "").slice(0, 160).join(""))}</blockquote>\n`
    : "";
  // Keep the parsed Telegram text below 4096 characters even with fallback context.
  const body = Array.from(row.body ?? "").slice(0, fallback ? 3800 : 4000).join("");
  return `${fallback}<blockquote>${escapeHtml(row.sender_label)}</blockquote>\n${escapeHtml(body)}`;
}

export function telegramMessagePayload(row: TelegramDeliveryContent) {
  // The native reply targets a message in THIS recipient's chat, never another chat.
  return {
    chat_id: row.chat_id,
    parse_mode: "HTML",
    text: buildText(row, !row.reply_message_id),
    ...(row.reply_message_id ? { reply_parameters: { message_id: row.reply_message_id, allow_sending_without_reply: true } } : {}),
  };
}

/** Text for editing an already-delivered copy: reply context is always a quote (edits cannot carry reply_parameters). */
export function telegramStoredMessageText(row: { sender_label: string; body: string | null; reply_label?: string | null; reply_body?: string | null }) {
  return buildText(row, true);
}

/** Appends an anonymous aggregate reaction footer, or returns the text unchanged when there are no reactions. */
export function withReactionFooter(text: string, counts: Array<{ emoji: string; total: number | bigint }>) {
  if (!counts.length) return text;
  const footer = `<blockquote>${counts.map((c) => `${c.emoji}×${c.total}`).join("  ")}</blockquote>`;
  return `${text}\n\n${footer}`;
}