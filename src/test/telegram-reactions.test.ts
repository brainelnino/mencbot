import { describe, it, expect } from "vitest";
import { telegramStoredMessageText, withReactionFooter } from "@/lib/telegram-format";

describe("reaction footer on the delivered message", () => {
  it("appends anonymous aggregate counts to the message text", () => {
    const base = telegramStoredMessageText({ sender_label: "11", body: "Habari" });
    const out = withReactionFooter(base, [{ emoji: "❤️", total: 2 }, { emoji: "👍", total: 1 }]);
    expect(out).toBe(`${base}\n\n<blockquote>❤️×2  👍×1</blockquote>`);
  });
  it("leaves the message unchanged when no reactions remain", () => {
    const base = telegramStoredMessageText({ sender_label: "11", body: "Habari" });
    expect(withReactionFooter(base, [])).toBe(base);
  });
  it("keeps reply context as a quote and escapes user text when editing", () => {
    const out = telegramStoredMessageText({ sender_label: "C", body: "a<b", reply_label: "11", reply_body: "x>y" });
    expect(out).toContain("<blockquote>↪ 11\nx&gt;y</blockquote>");
    expect(out).toContain("a&lt;b");
  });
});
