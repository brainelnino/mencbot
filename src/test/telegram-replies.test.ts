import { describe, expect, it } from "vitest";
import { telegramMessagePayload } from "@/lib/telegram-format";

describe("recipient-local replies", () => {
  it("links a reply to the recipient's original delivered Telegram message", () => {
    const result = telegramMessagePayload({ chat_id: 101, sender_label: "11", body: "Jibu", reply_message_id: 88, reply_label: "10", reply_body: "Habari" });
    expect(result.reply_parameters).toEqual({ message_id: 88, allow_sending_without_reply: true });
    expect(result.chat_id).toBe(101);
  });
  it("includes only safe stored context when a recipient has no original message", () => {
    const result = telegramMessagePayload({ chat_id: 202, sender_label: "11", body: "Jibu", reply_message_id: null, reply_label: "10", reply_body: "<script>&" });
    expect(result.reply_parameters).toBeUndefined();
    expect(result.text).toContain("↪ 10\n&lt;script&gt;&amp;");
  });
});