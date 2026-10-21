import { createFileRoute } from "@tanstack/react-router";
import { deriveWebhookSecret, safeEqual, type TgUpdate } from "@/lib/telegram-parse";
import { z } from "zod";

const updateSchema = z.object({
  update_id: z.number().int().nonnegative(),
  message: z.object({
    message_id: z.number().int(),
    from: z.object({ id: z.number().int(), is_bot: z.boolean().optional() }).passthrough().optional(),
    chat: z.object({ id: z.number().int(), type: z.string(), title: z.string().optional() }).passthrough(),
    text: z.string().optional(), photo: z.array(z.unknown()).optional(),
  }).passthrough().optional(),
}).passthrough();

export const Route = createFileRoute("/api/public/telegram/webhook")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const key = process.env["TELEGRAM_API_KEY"];
        if (!key) return new Response("Not configured", { status: 503 });
        const expected = await deriveWebhookSecret(key);
        const actual = request.headers.get("X-Telegram-Bot-Api-Secret-Token") ?? "";
        if (!safeEqual(actual, expected)) return new Response("Unauthorized", { status: 401 });

        let update: TgUpdate;
        try { update = updateSchema.parse(await request.json()) as TgUpdate; } catch { return new Response("Bad request", { status: 400 }); }
        if (typeof update?.update_id !== "number") return Response.json({ ok: true, ignored: true });

        const { handleUpdate } = await import("@/lib/telegram.server");
        try {
          await handleUpdate(update);
          return Response.json({ ok: true });
        } catch {
          // 500 makes Telegram retry; the update is marked failed so the retry is reprocessed.
          return new Response("Processing failed", { status: 500 });
        }
      },
    },
  },
});
