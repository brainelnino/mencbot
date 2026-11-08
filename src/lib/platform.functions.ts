import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

/** Owner-only: fetches a feedback photo from Telegram through the master bot and returns it as a data URL. */
export const getFeedbackPhoto = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: { id: string }) => {
    if (!/^[0-9a-f-]{36}$/.test(i?.id ?? "")) throw new Error("Bad id");
    return { id: i.id };
  })
  .handler(async ({ data, context }) => {
    const { data: owner } = await context.supabase.rpc("is_owner");
    if (!owner) throw new Error("Ni mmiliki pekee anayeruhusiwa");
    const { data: row } = await context.supabase.from("platform_feedback").select("photo_file_id").eq("id", data.id).maybeSingle();
    if (!row?.photo_file_id) return { url: null };
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: bot } = await supabaseAdmin.from("office_bots").select("bot_token").eq("office", "jukwaa").maybeSingle();
    if (!bot?.bot_token) return { url: null };
    const { botCall } = await import("./office.server");
    const file = await botCall<{ file_path: string }>(bot.bot_token, "getFile", { file_id: row.photo_file_id });
    const res = await fetch(`https://api.telegram.org/file/bot${bot.bot_token}/${file.file_path}`);
    if (!res.ok) return { url: null };
    const bytes = new Uint8Array(await res.arrayBuffer());
    let bin = ""; for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
    return { url: `data:image/jpeg;base64,${btoa(bin)}` };
  });
