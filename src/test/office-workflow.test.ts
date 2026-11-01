import { beforeEach, describe, expect, it, vi } from "vitest";
import { handleOfficeUpdate } from "@/lib/office.server";
import { t } from "@/lib/i18n";

const mocks = vi.hoisted(() => ({ rpc: vi.fn(), from: vi.fn(), slot: 1, claims: new Set<number>() }));
vi.mock("@/integrations/supabase/client.server", () => ({ supabaseAdmin: { rpc: mocks.rpc, from: mocks.from } }));
const calls: Array<{ method: string; body: Record<string, any> }> = [];
const token = "999999:test-only";
const message = (text: string, reply?: string) => ({ chat: { id: 42, type: "private" }, from: { id: 42 }, text, ...(reply ? { reply_to_message: { from: { id: 999999 }, text: reply } } : {}) });
const callback = (id: number, data: string, text = "", messageId = 20) => ({ update_id: id, callback_query: { id: String(id), from: { id: 42 }, data, message: { chat: { id: 42, type: "private" }, message_id: messageId, text } } });

beforeEach(() => {
  calls.length = 0; mocks.claims.clear(); mocks.slot = 1;
  mocks.rpc.mockReset().mockImplementation(async (name: string) => ({ data: name === "get_telegram_admin_slot" ? mocks.slot : null, error: null }));
  mocks.from.mockImplementation((table: string) => ({
    insert: async (row: { update_id: number }) => {
      if (table !== "office_updates") return { error: null };
      if (mocks.claims.has(row.update_id)) return { error: { code: "23505" } };
      mocks.claims.add(row.update_id); return { error: null };
    },
    update: () => ({ eq: async () => ({ error: null }) }),
    select: () => ({ eq: () => ({ single: async () => ({ data: { webhook_secret: "test-secret" }, error: null }) }) }),
  }));
  vi.stubGlobal("fetch", vi.fn(async (url: string, init: RequestInit) => {
    const method = url.split("/").at(-1) ?? "";
    calls.push({ method, body: JSON.parse(String(init.body)) });
    return Response.json({ ok: true, result: method === "getWebhookInfo" ? { url: "https://example.org/webhook", allowed_updates: ["message"] } : { message_id: 20 } });
  }));
});

describe("Raisi guided workflow", () => {
  it("upgrades existing webhook and completes F appointment only after confirmation", async () => {
    await handleOfficeUpdate("raisi", token, { update_id: 1, message: message("/menu") });
    expect(calls.find((x) => x.method === "setWebhook")?.body["allowed_updates"]).toContain("callback_query");
    await handleOfficeUpdate("raisi", token, callback(2, "o:teua"));
    await handleOfficeUpdate("raisi", token, callback(3, "o:teua:3"));
    await handleOfficeUpdate("raisi", token, { update_id: 4, message: message("F", t.office.idPrompt(3)) });
    expect(mocks.rpc.mock.calls.some(([name]) => name === "raisi_appoint")).toBe(false);
    await handleOfficeUpdate("raisi", token, callback(5, "o:confirm:teua:F:3"));
    expect(mocks.rpc).toHaveBeenCalledWith("raisi_appoint", { _actor_tg: 42, _label: "F", _slot: 3 });
    await handleOfficeUpdate("raisi", token, callback(6, "o:confirm:teua:F:3"));
    expect(mocks.rpc.mock.calls.filter(([name]) => name === "raisi_appoint")).toHaveLength(1);
  });
  it("rejects a leader whose slot has been revoked before confirmation", async () => {
    mocks.slot = 0;
    await handleOfficeUpdate("raisi", token, callback(1, "o:confirm:ondoa:5"));
    expect(mocks.rpc.mock.calls.some(([name]) => name === "raisi_remove")).toBe(false);
    expect(calls.find((x) => x.method === "answerCallbackQuery")?.body["show_alert"]).toBe(true);
  });
  it("shows speech preview without broadcasting it", async () => {
    await handleOfficeUpdate("raisi", token, callback(1, "o:hotuba"));
    await handleOfficeUpdate("raisi", token, { update_id: 2, message: message("Habari jamii", t.office.speechPrompt) });
    const card = calls.filter((x) => x.method === "sendMessage").at(-1);
    expect(card?.body["reply_markup"].inline_keyboard[0][0].callback_data).toBe("o:confirm:hotuba");
    expect(mocks.from.mock.calls.some(([table]) => table === "messages")).toBe(false);
  });
});