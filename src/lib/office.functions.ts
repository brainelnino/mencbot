import { createServerFn } from "@tanstack/react-start";
import { getRequest } from "@tanstack/react-start/server";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { isOfficeKey } from "./office-config";

async function assertOwner(supabase: { rpc: (n: "is_owner") => PromiseLike<{ data: boolean | null }> }) {
  const { data } = await supabase.rpc("is_owner");
  if (!data) throw new Error("Ni mmiliki pekee anayeruhusiwa");
}

function officeUrl(origin: string, office: string) {
  const u = new URL(origin);
  const m = /^id-preview--([0-9a-f-]+)\.(.+)$/.exec(u.host);
  const host = m ? `project--${m[1]}-dev.${m[2]}` : u.host;
  return `https://${host}/api/public/telegram/ofisi/${office}`;
}

/** Saves (or replaces) an office bot token, verifies it with Telegram and activates its webhook. */
export const saveOfficeToken = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: { office: string; token: string }) => {
    if (!isOfficeKey(i?.office ?? "")) throw new Error("Ofisi haijulikani");
    const token = (i.token ?? "").trim();
    if (!/^\d{5,15}:[A-Za-z0-9_-]{30,60}$/.test(token)) throw new Error("TOKEN si sahihi — nakili kutoka @BotFather");
    return { office: i.office, token };
  })
  .handler(async ({ data, context }) => {
    await assertOwner(context.supabase);
    const { botCall } = await import("./office.server");
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    let me: { username: string };
    try { me = await botCall<{ username: string }>(data.token, "getMe"); }
    catch { throw new Error("Telegram imekataa TOKEN hii. Hakikisha bot ipo na TOKEN ni mpya."); }
    const { data: others } = await supabaseAdmin.from("office_bots").select("office").eq("bot_username", me.username).neq("office", data.office);
    if (others?.length) throw new Error(`Bot @${me.username} tayari inatumika na ofisi nyingine`);
    const { data: old } = await supabaseAdmin.from("office_bots").select("bot_token").eq("office", data.office).single();
    const secret = Array.from(crypto.getRandomValues(new Uint8Array(32)), (b) => b.toString(16).padStart(2, "0")).join("");
    const url = officeUrl(new URL(getRequest().url).origin, data.office);
    await botCall(data.token, "setWebhook", { url, secret_token: secret, allowed_updates: ["message", "callback_query"], drop_pending_updates: false });
    await botCall(data.token, "setMyCommands", { commands: data.office === "jukwaa" ? [{ command: "start", description: "Unganisha au simamia bot yako" }] : data.office === "raisi"
      ? [{ command: "menu", description: "Menyu ya ofisi" }, { command: "ripoti", description: "Hali ya nchi" }, { command: "viongozi", description: "Viongozi wote" }]
      : [{ command: "menu", description: "Menyu ya ofisi" }] }).catch(() => undefined);
    if (old?.bot_token && old.bot_token !== data.token) await botCall(old.bot_token, "deleteWebhook").catch(() => undefined);
    const { error } = await supabaseAdmin.from("office_bots").update({
      bot_token: data.token, bot_username: me.username, webhook_secret: secret, is_active: true, last_error: null, updated_at: new Date().toISOString(),
    }).eq("office", data.office);
    if (error) throw error;
    await context.supabase.rpc("write_audit", { _action: "office.token_set", _target_type: "office", _target_id: data.office, _details: { bot: me.username } });
    return { username: me.username };
  });

/** Turns an office bot off (or back on) without deleting its token. */
export const setOfficeActive = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: { office: string; active: boolean }) => {
    if (!isOfficeKey(i?.office ?? "")) throw new Error("Ofisi haijulikani");
    return { office: i.office, active: !!i.active };
  })
  .handler(async ({ data, context }) => {
    await assertOwner(context.supabase);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: row } = await supabaseAdmin.from("office_bots").select("bot_token").eq("office", data.office).single();
    if (data.active && !row?.bot_token) throw new Error("Weka TOKEN kwanza");
    await supabaseAdmin.from("office_bots").update({ is_active: data.active, updated_at: new Date().toISOString() }).eq("office", data.office);
    await context.supabase.rpc("write_audit", { _action: data.active ? "office.enabled" : "office.disabled", _target_type: "office", _target_id: data.office, _details: {} });
    return { ok: true };
  });
