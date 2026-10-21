import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({ pending: true, sends: [] as Record<string, unknown>[], saved: [] as Record<string, unknown>[] }));
vi.mock("@/integrations/supabase/client.server", () => ({ supabaseAdmin: {
  rpc: async (name: string) => name === "claim_private_deliveries" ? { error: null, data: state.pending ? (state.pending = false, [{ id: "a", chat_id: 101, sender_label: "11", body: "Habari" }, { id: "b", chat_id: 202, sender_label: "11", body: "Habari" }]) : [] } : { error: null },
  from: () => ({
    update: (patch: Record<string, unknown>) => ({ eq: async () => { state.saved.push(patch); return { error: null }; } }),
    select: () => ({ eq: () => ({ in: async () => ({ count: 0, error: null }) }) }),
  }),
} }));
import { publishMessage } from "@/lib/telegram.server";

beforeEach(() => {
  state.pending = true; state.sends = []; state.saved = [];
  vi.stubEnv("LOVABLE_API_KEY", "test"); vi.stubEnv("TELEGRAM_API_KEY", "test");
  vi.stubGlobal("fetch", vi.fn(async (_url, init) => {
    state.sends.push(JSON.parse(init.body));
    return new Response(JSON.stringify({ ok: true, result: { message_id: 9 } }));
  }));
});
describe("direct private broadcast", () => {
  it("sends accepted text to every claimed private recipient without approval or a group", async () => {
    await publishMessage("message");
    expect(state.sends).toEqual([{ chat_id: 101, text: "11\nHabari" }, { chat_id: 202, text: "11\nHabari" }]);
    expect(state.saved.filter((p) => p.status === "sent")).toHaveLength(2);
  });
  it("does not resend deliveries that have already been completed", async () => {
    await publishMessage("message"); await publishMessage("message");
    expect(state.sends).toHaveLength(2);
  });
  it("records a blocked recipient without stopping delivery to another member", async () => {
    vi.stubGlobal("fetch", vi.fn(async (_url, init) => {
      const body = JSON.parse(init.body); state.sends.push(body);
      return body.chat_id === 101 ? new Response(JSON.stringify({ ok: false, description: "blocked" }), { status: 403 }) : new Response(JSON.stringify({ ok: true, result: { message_id: 10 } }));
    }));
    await publishMessage("message");
    expect(state.saved.some((p) => p.status === "unreachable")).toBe(true);
    expect(state.saved.some((p) => p.status === "sent")).toBe(true);
  });
});