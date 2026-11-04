import { createServerFn } from "@tanstack/react-start";
import { getRequest } from "@tanstack/react-start/server";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

async function assertOwner(supabase: { rpc: (n: "is_owner") => PromiseLike<{ data: boolean | null }> }) {
  const { data } = await supabase.rpc("is_owner");
  if (!data) throw new Error("Ni mmiliki pekee anayeruhusiwa");
}

export const getTelegramStatus = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await assertOwner(context.supabase);
    const { tg } = await import("./telegram.server");
    const { data: cfg } = await context.supabase.from("telegram_config")
      .select("bot_username,webhook_registered,webhook_url,last_update_at,last_error,last_error_at,public_group_chat_id,group_title,group_verified_at,group_link_code,group_link_expires_at")
      .limit(1).maybeSingle();
    let bot: string | null = null, botError: string | null = null;
    let webhook: { url: string; pending_update_count: number; last_error_message?: string } | null = null;
    try {
      const me = await tg<{ username: string }>("getMe");
      bot = me.username;
      webhook = await tg("getWebhookInfo");
    } catch (e) { botError = e instanceof Error ? e.message : "error"; }
    return {
      bot, botError,
      webhookUrl: webhook?.url || null,
      pending: webhook?.pending_update_count ?? 0,
      telegramWebhookError: webhook?.last_error_message ?? null,
      lastUpdateAt: cfg?.last_update_at ?? null,
      lastError: cfg?.last_error ?? null,
      lastErrorAt: cfg?.last_error_at ?? null,
      groupConfigured: !!cfg?.public_group_chat_id,
      groupTitle: cfg?.group_title ?? null,
      groupVerifiedAt: cfg?.group_verified_at ?? null,
      linkCode: cfg?.group_link_expires_at && new Date(cfg.group_link_expires_at) > new Date() ? cfg.group_link_code : null,
    };
  });

export const registerWebhook = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await assertOwner(context.supabase);
    const { tg } = await import("./telegram.server");
    const { deriveWebhookSecret, publicWebhookUrl } = await import("./telegram-parse");
    const url = publicWebhookUrl(new URL(getRequest().url).origin);
    const secret = await deriveWebhookSecret(process.env["TELEGRAM_API_KEY"]!);
    await tg("setWebhook", { url, secret_token: secret, allowed_updates: ["message", "message_reaction", "callback_query"] });
    const me = await tg<{ username: string }>("getMe");
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: cfg } = await supabaseAdmin.from("telegram_config").select("id").limit(1).single();
    if (!cfg) throw new Error("Telegram haijasanidiwa");
    await supabaseAdmin.from("telegram_config").update({ webhook_registered: true, webhook_url: url, bot_username: me.username }).eq("id", cfg.id);
    await context.supabase.rpc("write_audit", { _action: "telegram.webhook_registered", _target_type: "telegram", _target_id: "webhook", _details: { url } });
    return { url };
  });

export const createGroupLinkCode = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await assertOwner(context.supabase);
    const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
    const bytes = crypto.getRandomValues(new Uint8Array(8));
    const code = Array.from(bytes, (b) => alphabet[b % alphabet.length]).join("");
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: cfg } = await supabaseAdmin.from("telegram_config").select("id").limit(1).single();
    if (!cfg) throw new Error("Telegram haijasanidiwa");
    await supabaseAdmin.from("telegram_config").update({ group_link_code: code, group_link_expires_at: new Date(Date.now() + 15 * 60_000).toISOString() }).eq("id", cfg.id);
    await context.supabase.rpc("write_audit", { _action: "telegram.group_link_code_created", _target_type: "telegram", _target_id: "group", _details: {} });
    return { code };
  });

export const retryPublication = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: { messageId: string }) => {
    if (!/^[0-9a-f-]{36}$/.test(i?.messageId ?? "")) throw new Error("Invalid id");
    return i;
  })
  .handler(async ({ data, context }) => {
    await assertOwner(context.supabase);
    const { publishMessage } = await import("./telegram.server");
    await publishMessage(data.messageId);
    await context.supabase.rpc("write_audit", { _action: "message.publish", _target_type: "message", _target_id: data.messageId, _details: {} });
    return { ok: true };
  });
