// Server-only: leadership office bots. Each office has its own bot token stored owner-only in the database.
import { OFFICES, SLOT_TITLES, type OfficeKey } from "./office-config";

export class OfficeError extends Error {}

async function admin() {
  return (await import("@/integrations/supabase/client.server")).supabaseAdmin;
}

/** Calls the Telegram Bot API directly with one office bot's token. */
export async function botCall<T = unknown>(token: string, method: string, body: Record<string, unknown> = {}): Promise<T> {
  const res = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body), signal: AbortSignal.timeout(8000),
  });
  const json = (await res.json().catch(() => ({}))) as { ok?: boolean; result?: T; description?: string };
  if (!res.ok || !json.ok) throw new OfficeError(`${method} [${res.status}]: ${json.description ?? "error"}`);
  return json.result as T;
}

export const RAISI_MENU = [
  "👳🏾 <b>Ofisi ya Raisi</b>",
  "",
  "/ripoti — hali ya nchi",
  "/viongozi — viongozi wote na nafasi zao",
  "/teua ID NAFASI — teua kiongozi (nafasi 2–9)",
  "/ondoa NAFASI — ondoa cheo",
  "/hamisha KUTOKA KWENDA — hamisha cheo",
  "/hotuba ujumbe — hotuba kwa jamii nzima",
].join("\n");

const KEYBOARD = { keyboard: [[{ text: "/ripoti" }, { text: "/viongozi" }], [{ text: "/menu" }]], resize_keyboard: true };

type Upd = { update_id: number; message?: { chat: { id: number; type: string }; from?: { id: number } | undefined; text?: string | undefined } | undefined };

/** Parses a Raisi command; pure for tests. */
export function parseRaisiCommand(text: string):
  | { cmd: "menu" | "ripoti" | "viongozi" }
  | { cmd: "teua"; label: string; slot: number }
  | { cmd: "ondoa"; slot: number }
  | { cmd: "hamisha"; from: number; to: number }
  | { cmd: "hotuba"; body: string }
  | { cmd: "unknown" } {
  const s = text.trim();
  let m: RegExpExecArray | null;
  if (/^\/(start|menu)(@\w+)?$/i.test(s)) return { cmd: "menu" };
  if (/^\/ripoti(@\w+)?$/i.test(s)) return { cmd: "ripoti" };
  if (/^\/viongozi(@\w+)?$/i.test(s)) return { cmd: "viongozi" };
  if ((m = /^\/teua(?:@\w+)?\s+([A-Za-z]|\d+)\s+(\d)$/i.exec(s))) return { cmd: "teua", label: m[1]!.toUpperCase(), slot: Number(m[2]) };
  if ((m = /^\/ondoa(?:@\w+)?\s+(\d)$/i.exec(s))) return { cmd: "ondoa", slot: Number(m[1]) };
  if ((m = /^\/hamisha(?:@\w+)?\s+(\d)\s+(\d)$/i.exec(s))) return { cmd: "hamisha", from: Number(m[1]), to: Number(m[2]) };
  if ((m = /^\/hotuba(?:@\w+)?\s+([\s\S]{2,3500})$/i.exec(s))) return { cmd: "hotuba", body: m[1]!.trim() };
  return { cmd: "unknown" };
}

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

export async function handleOfficeUpdate(office: OfficeKey, token: string, update: Upd) {
  const db = await admin();
  const { error: dup } = await db.from("office_updates").insert({ office, update_id: update.update_id });
  if (dup) { if (dup.code === "23505") return; throw dup; }
  await db.from("office_bots").update({ last_update_at: new Date().toISOString() }).eq("office", office);

  const msg = update.message;
  if (!msg?.from || msg.chat.type !== "private" || !msg.text) return;
  const chat_id = msg.chat.id;
  const say = (text: string, extra: Record<string, unknown> = {}) => botCall(token, "sendMessage", { chat_id, text, parse_mode: "HTML", ...extra });

  const def = OFFICES.find((o) => o.key === office)!;
  const { data: slot } = await db.rpc("get_telegram_admin_slot", { _tg_user_id: msg.from.id });
  if (!slot || !def.slots.includes(slot)) {
    await say("🚫 Hii ni ofisi teule ya uongozi. Huna mamlaka hapa.");
    return;
  }

  if (office !== "raisi") {
    await say(`${SLOT_TITLES[slot]}\n\nKaribu ofisini. Zana za ofisi hii zinaandaliwa na zitafunguliwa hivi karibuni.`);
    return;
  }

  const c = parseRaisiCommand(msg.text);
  const audit = (action: string, details: { [k: string]: string }) => db.from("audit_events").insert({ action, target_type: "office", target_id: office, details: details as never });
  try {
    switch (c.cmd) {
      case "menu": await say(RAISI_MENU, { reply_markup: KEYBOARD }); break;
      case "unknown": await say("Amri haijatambulika.\n\n" + RAISI_MENU); break;
      case "ripoti":
      case "viongozi": {
        const { data, error } = await db.rpc("office_report");
        if (error) throw error;
        const r = data as { members: number; banned: number; messages_today: number; leaders: { slot: number; label: string; active: boolean }[] };
        const leaders = Array.from({ length: 9 }, (_, i) => {
          const l = r.leaders.find((x) => x.slot === i + 1);
          return `${i + 1}. ${SLOT_TITLES[i + 1]} — ${l ? `${esc(l.label)}${l.active ? "" : " (amezimwa)"}` : "wazi"}`;
        }).join("\n");
        await say(c.cmd === "ripoti"
          ? `📊 <b>Hali ya nchi</b>\n\nWanachama hai: ${r.members}\nWaliozuiwa: ${r.banned}\nJumbe saa 24: ${r.messages_today}\n\n${leaders}`
          : `🏛 <b>Viongozi</b>\n\n${leaders}`);
        break;
      }
      case "teua": {
        const { error } = await db.rpc("raisi_appoint", { _actor_tg: msg.from.id, _label: c.label, _slot: c.slot });
        if (error) throw new OfficeError(error.message);
        await say(`✅ ${esc(c.label)} ameteuliwa kuwa ${SLOT_TITLES[c.slot]} (nafasi ${c.slot}).`);
        break;
      }
      case "ondoa": {
        const { error } = await db.rpc("raisi_remove", { _actor_tg: msg.from.id, _slot: c.slot });
        if (error) throw new OfficeError(error.message);
        await say(`✅ Cheo cha nafasi ${c.slot} (${SLOT_TITLES[c.slot]}) kimeondolewa.`);
        break;
      }
      case "hamisha": {
        const { error } = await db.rpc("raisi_move", { _actor_tg: msg.from.id, _from: c.from, _to: c.to });
        if (error) throw new OfficeError(error.message);
        await say(`✅ Kiongozi wa nafasi ${c.from} sasa ni ${SLOT_TITLES[c.to]} (nafasi ${c.to}).`);
        break;
      }
      case "hotuba": {
        const { data: mem } = await db.from("members").select("id,public_identities(label)").eq("telegram_user_id", msg.from.id).single();
        const label = (mem?.public_identities as { label: string } | null)?.label;
        if (!mem || !label) throw new OfficeError("Akaunti ya Raisi haijapatikana");
        const { data: row, error } = await db.from("messages").insert({
          member_id: mem.id, sender_label: label, kind: "text", body: `👳🏾 HOTUBA YA RAISI\n\n${c.body}`,
          moderation_status: "pending", publication_status: "unpublished", processing_status: "awaiting_moderation",
        }).select("id").single();
        if (error) throw error;
        await audit("raisi.hotuba", { message_id: row.id });
        const { publishMessage } = await import("./telegram.server");
        await say("📣 Hotuba inatumwa kwa jamii nzima…");
        await publishMessage(row.id);
        break;
      }
    }
  } catch (e) {
    if (e instanceof OfficeError) { await say(`⚠️ ${esc(e.message)}`); return; }
    throw e;
  }
}
