import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { safeEqual, type TgUpdate } from "@/lib/telegram-parse";

const schema = z.object({
  update_id: z.number().int().nonnegative(),
  message: z.object({
    message_id: z.number().int(),
    from: z.object({ id: z.number().int() }).passthrough().optional(),
    chat: z.object({ id: z.number().int(), type: z.string() }).passthrough(),
    text: z.string().max(4096).optional(),
    caption: z.string().max(1024).optional(),
  }).passthrough().optional(),
  callback_query: z.object({
    id: z.string(), from: z.object({id:z.number().int()}).passthrough(), data:z.string().max(64).optional(),
    message:z.object({message_id:z.number().int(),chat:z.object({id:z.number().int(),type:z.string()}).passthrough()}).passthrough().optional(),
  }).passthrough().optional(),
  message_reaction:z.object({
    message_id:z.number().int(),chat:z.object({id:z.number().int(),type:z.string()}).passthrough(),
    user:z.object({id:z.number().int()}).passthrough().optional(),
    new_reaction:z.array(z.object({type:z.string(),emoji:z.string().max(32).optional()}).passthrough()).optional(),
  }).passthrough().optional(),
}).passthrough();

// Community bots created through the platform bot. Each has its own random secret.
export const Route = createFileRoute("/api/public/telegram/kikundi/$botId")({
  server: {
    handlers: {
      POST: async ({ request, params }) => {
        if (!z.string().uuid().safeParse(params.botId).success) return new Response("Not found", { status: 404 });
        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const { data: bot } = await supabaseAdmin.from("tenant_bots").select("id,bot_username,bot_token,webhook_secret,welcome_message,content_policy,is_active,owner_tg_user_id,blocked_words,vote_policy,platform_suspended").eq("id", params.botId).maybeSingle();
        if (!bot) return new Response("Not found", { status: 404 });
        if (!safeEqual(request.headers.get("X-Telegram-Bot-Api-Secret-Token") ?? "", bot.webhook_secret)) return new Response("Unauthorized", { status: 401 });
        if (!bot.is_active || bot.platform_suspended) return Response.json({ ok: true, ignored: true });
        let update: TgUpdate;
        try { update = schema.parse(await request.json()) as TgUpdate; } catch { return new Response("Bad request", { status: 400 }); }
        const { handleTenantUpdate } = await import("@/lib/platform.server");
        try {
          await handleTenantUpdate(bot, update);
          return Response.json({ ok: true });
        } catch (e) {
          await supabaseAdmin.from("tenant_bots").update({ last_error: e instanceof Error ? e.message.slice(0, 300) : "error" }).eq("id", bot.id);
          return Response.json({ ok: true, error: true });
        }
      },
    },
  },
});
