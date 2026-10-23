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

export function telegramMessagePayload(row: TelegramDeliveryContent) {
  // The native reply targets a message in THIS recipient's chat, never another chat.
  const fallback = row.reply_label && !row.reply_message_id
    ? `<blockquote>↪ ${escapeHtml(row.reply_label)}\n${escapeHtml(Array.from(row.reply_body ?? "").slice(0, 160).join(""))}</blockquote>\n`
    : "";
  // Keep the parsed Telegram text below 4096 characters even with fallback context.
  const body = Array.from(row.body ?? "").slice(0, fallback ? 3800 : 4000).join("");
  return {
    chat_id: row.chat_id,
    parse_mode: "HTML",
    text: `${fallback}<blockquote>${escapeHtml(row.sender_label)}</blockquote>\n${escapeHtml(body)}`,
    ...(row.reply_message_id ? { reply_parameters: { message_id: row.reply_message_id, allow_sending_without_reply: true } } : {}),
  };
}