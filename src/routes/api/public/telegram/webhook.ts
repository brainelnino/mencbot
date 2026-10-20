import { createFileRoute } from "@tanstack/react-router";
import { deriveWebhookSecret, safeEqual, type TgUpdate } from "@/lib/telegram-parse";

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
        try { update = await request.json(); } catch { return new Response("Bad request", { status: 400 }); }
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
