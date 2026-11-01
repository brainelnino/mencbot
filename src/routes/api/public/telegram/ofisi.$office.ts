import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { isOfficeKey } from "@/lib/office-config";
import { safeEqual } from "@/lib/telegram-parse";

const schema = z.object({
  update_id: z.number().int().nonnegative(),
  message: z.object({
    chat: z.object({ id: z.number().int(), type: z.string() }).passthrough(),
    from: z.object({ id: z.number().int() }).passthrough().optional(),
    message_id: z.number().int().positive().optional(),
    text: z.string().max(4096).optional(),
    reply_to_message: z.object({ from: z.object({ id: z.number().int() }).passthrough().optional(), text: z.string().max(4096).optional() }).passthrough().optional(),
  }).passthrough().optional(),
  callback_query: z.object({
    id: z.string().max(256), from: z.object({ id: z.number().int() }).passthrough(), data: z.string().max(64).optional(),
    message: z.object({ message_id: z.number().int().positive(), chat: z.object({ id: z.number().int(), type: z.string() }).passthrough(), text: z.string().max(4096).optional() }).passthrough().optional(),
  }).passthrough().optional(),
}).passthrough();

export const Route = createFileRoute("/api/public/telegram/ofisi/$office")({
  server: {
    handlers: {
      POST: async ({ request, params }) => {
        if (!isOfficeKey(params.office)) return new Response("Not found", { status: 404 });
        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const { data: bot } = await supabaseAdmin.from("office_bots").select("bot_token,webhook_secret,is_active").eq("office", params.office).maybeSingle();
        if (!bot?.bot_token || !bot.webhook_secret || !bot.is_active) return new Response("Not active", { status: 404 });
        const actual = request.headers.get("X-Telegram-Bot-Api-Secret-Token") ?? "";
        if (!safeEqual(actual, bot.webhook_secret)) return new Response("Unauthorized", { status: 401 });
        let update;
        try { update = schema.parse(await request.json()); } catch { return new Response("Bad request", { status: 400 }); }
        const { handleOfficeUpdate } = await import("@/lib/office.server");
        try {
          await handleOfficeUpdate(params.office, bot.bot_token, update);
          return Response.json({ ok: true });
        } catch (e) {
          await supabaseAdmin.from("office_bots").update({ last_error: e instanceof Error ? e.message.slice(0, 300) : "error" }).eq("office", params.office);
          return new Response("Processing failed", { status: 500 });
        }
      },
    },
  },
});
