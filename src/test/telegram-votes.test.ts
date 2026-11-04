import { describe, it, expect } from "vitest";
import { voteKeyboard } from "@/lib/telegram-format";
import { classifyUpdate } from "@/lib/telegram-parse";

describe("✅/❌ vote buttons", () => {
  it("shows plain buttons with no votes", () => {
    expect(voteKeyboard().inline_keyboard[0].map((b) => b.text)).toEqual(["✅", "❌"]);
  });
  it("shows anonymous counts", () => {
    expect(voteKeyboard([{ emoji: "✅", total: 3 }]).inline_keyboard[0].map((b) => b.text)).toEqual(["✅ 3", "❌"]);
  });
  it("classifies a button press in a private chat", () => {
    const c = classifyUpdate({ update_id: 1, callback_query: { id: "q", from: { id: 9 }, data: "v:❌", message: { message_id: 4, chat: { id: 9, type: "private" } } } });
    expect(c).toMatchObject({ kind: "vote", emoji: "❌", messageId: 4 });
  });
  it("ignores unknown button data", () => {
    expect(classifyUpdate({ update_id: 1, callback_query: { id: "q", from: { id: 9 }, data: "x", message: { message_id: 4, chat: { id: 9, type: "private" } } } }).kind).toBe("ignored");
  });
});
