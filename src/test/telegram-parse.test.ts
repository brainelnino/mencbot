import { describe, it, expect } from "vitest";
import { classifyUpdate, deriveWebhookSecret, safeEqual, publicWebhookUrl } from "@/lib/telegram-parse";

const priv = (text: string) => ({ update_id: 1, message: { message_id: 5, from: { id: 42 }, chat: { id: 42, type: "private" }, text } });

describe("telegram parsing", () => {
  it("recognises assistant commands by public ID without broadcasting them", () => {
    expect(classifyUpdate(priv("/zuia 11"))).toMatchObject({ kind: "admin_command", command: "zuia", label: "11", userId: 42 });
    expect(classifyUpdate(priv("/rudisha C"))).toMatchObject({ kind: "admin_command", command: "rudisha", label: "C" });
  });
  it("recognises /start in a private chat", () => expect(classifyUpdate(priv("/start")).kind).toBe("start"));
  it("treats other private text as a message for review", () => expect(classifyUpdate(priv("Habari")).kind).toBe("private_text"));
  it("ignores ordinary group messages", () =>
    expect(classifyUpdate({ update_id: 2, message: { message_id: 1, from: { id: 1 }, chat: { id: -100, type: "supergroup" }, text: "hi" } }).kind).toBe("ignored"));
  it("accepts a group link command with a code", () => {
    const c = classifyUpdate({ update_id: 3, message: { message_id: 1, from: { id: 1 }, chat: { id: -100, type: "supergroup", title: "G" }, text: "/unganisha ABCD2345" } });
    expect(c).toMatchObject({ kind: "group_link", code: "ABCD2345", chatId: -100 });
  });
  it("ignores bot senders", () =>
    expect(classifyUpdate({ update_id: 4, message: { message_id: 1, from: { id: 1, is_bot: true }, chat: { id: 1, type: "private" }, text: "/start" } }).kind).toBe("ignored"));
  it("derives a stable secret and rejects a wrong one", async () => {
    const a = await deriveWebhookSecret("k1");
    expect(await deriveWebhookSecret("k1")).toBe(a);
    expect(safeEqual(a, await deriveWebhookSecret("k2"))).toBe(false);
  });
  it("maps the editor preview host to the public dev host", () =>
    expect(publicWebhookUrl("https://id-preview--abc-123.lovable.app")).toBe("https://project--abc-123-dev.lovable.app/api/public/telegram/webhook"));
});
