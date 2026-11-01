// Server-only: leadership office bots. Each office has its own bot token stored owner-only in the database.
import { OFFICES, SLOT_TITLES, type OfficeKey } from "./office-config";
import { t } from "./i18n";
import { parseRaisiCommand, parseOfficeCallback, officeHomeKeyboard, officeBackKeyboard, officeSlotsKeyboard, officeConfirmKeyboard, type RaisiCommand } from "./office-interaction";

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

export { parseRaisiCommand } from "./office-interaction";

type OfficeMessage = {
  message_id?: number | undefined;
  chat: { id: number; type: string };
  from?: { id: number } | undefined;
  text?: string | undefined;
  reply_to_message?: { from?: { id: number } | undefined; text?: string | undefined } | undefined;
};
export type OfficeUpdate = {
  update_id: number;
  message?: OfficeMessage | undefined;
  callback_query?: { id: string; from: { id: number }; data?: string | undefined; message?: OfficeMessage | undefined } | undefined;
};

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

export async function handleOfficeUpdate(office: OfficeKey, token: string, update: OfficeUpdate) {
  const db = await admin();
  const { error: dup } = await db.from("office_updates").insert({ office, update_id: update.update_id });
  if (dup) { if (dup.code === "23505") return; throw dup; }
  await db.from("office_bots").update({ last_update_at: new Date().toISOString() }).eq("office", office);

  const cb = update.callback_query;
  const msg = cb?.message ?? update.message;
  const actor = cb?.from ?? msg?.from;
  if (!msg || !actor || msg.chat.type !== "private") return;
  const chat_id = msg.chat.id;
  const say = (text: string, extra: Record<string, unknown> = {}) => botCall(token, "sendMessage", { chat_id, text, parse_mode: "HTML", ...extra });
  const def = OFFICES.find((o) => o.key === office);
  const { data: slot, error: slotError } = await db.rpc("get_telegram_admin_slot", { _tg_user_id: actor.id });
  if (slotError) throw slotError;
  if (!slot || !def?.slots.includes(slot)) {
    if (cb) await botCall(token, "answerCallbackQuery", { callback_query_id: cb.id, text: t.office.denied, show_alert: true });
    else await say(t.office.denied);
    return;
  }
  if (cb) await botCall(token, "answerCallbackQuery", { callback_query_id: cb.id });
  if (office !== "raisi") {
    await say(`${SLOT_TITLES[slot]}\n\n${t.office.unavailable}`);
    return;
  }
  const home = () => say(t.office.home, { reply_markup: officeHomeKeyboard });
  const prompt = (text: string) => say(text, { reply_markup: { force_reply: true, selective: true } });
  let c = cb ? parseOfficeCallback(cb.data ?? "") : parseRaisiCommand(msg.text ?? "");
  const preview = async (command: RaisiCommand) => {
    if (command.cmd === "teua") await say(`${t.office.preview}\n\n${esc(command.label)} → ${SLOT_TITLES[command.slot]} (${command.slot})`, { reply_markup: officeConfirmKeyboard(`teua:${command.label}:${command.slot}`) });
    if (command.cmd === "ondoa") await say(`${t.office.preview}\n\n${t.office.remove}: ${SLOT_TITLES[command.slot]} (${command.slot})`, { reply_markup: officeConfirmKeyboard(`ondoa:${command.slot}`) });
    if (command.cmd === "hamisha") await say(`${t.office.preview}\n\n${SLOT_TITLES[command.from]} (${command.from}) → ${SLOT_TITLES[command.to]} (${command.to})`, { reply_markup: officeConfirmKeyboard(`hamisha:${command.from}:${command.to}`) });
    if (command.cmd === "hotuba") await say(`<b>${t.office.speechPreview}</b>\n\n${esc(command.body)}`, { reply_markup: officeConfirmKeyboard("hotuba", true) });
  };
  if (!cb && msg.reply_to_message?.from?.id === Number(token.split(":")[0])) {
    const parent = msg.reply_to_message.text ?? "";
    const input = msg.text?.trim() ?? "";
    const target = /^👤 Nafasi ([2-9])\n/.exec(parent);
    if (target) {
      if (!/^(?:[A-Za-z]|\d{2,10})$/.test(input)) { await say(t.office.invalidId); await prompt(parent); return; }
      c = { cmd: "teua", label: input.toUpperCase(), slot: Number(target[1]) };
    } else if (parent === t.office.speechPrompt) {
      if (input.length < 2 || input.length > 3500) { await say(t.office.invalidSpeech); await prompt(parent); return; }
      c = { cmd: "hotuba", body: input };
    }
  }
  if (c.cmd === "prompt") {
    if (c.action === "hotuba") await prompt(t.office.speechPrompt);
    else await say(c.action === "teua" ? t.office.chooseAppoint : c.action === "ondoa" ? t.office.chooseRemove : t.office.chooseFrom, { reply_markup: officeSlotsKeyboard(c.action) });
    return;
  }
  if (c.cmd === "choose") {
    if (c.action === "teua") await prompt(t.office.idPrompt(c.slot));
    else if (c.action === "ondoa") await preview({ cmd: "ondoa", slot: c.slot });
    else await say(t.office.chooseTo, { reply_markup: officeSlotsKeyboard(`to:${c.slot}`, c.slot) });
    return;
  }
  if (c.cmd === "destination") { await preview({ cmd: "hamisha", from: c.from, to: c.to }); return; }
  if (c.cmd === "confirmSpeech") {
    const prefix = `${t.office.speechPreview}\n\n`;
    if (!msg.text?.startsWith(prefix)) { await say(t.office.stale); await home(); return; }
    c = { cmd: "hotuba", body: msg.text.slice(prefix.length) };
    if (c.body.length < 2 || c.body.length > 3500) return;
  }
  const mutates = ["teua", "ondoa", "hamisha", "hotuba"].includes(c.cmd);
  if (mutates && !cb) { await preview(c); return; }
  if (mutates && cb && msg.message_id) {
    // A confirmation card can execute only once, even if its button is pressed repeatedly.
    const { error: used } = await db.from("office_updates").insert({ office, update_id: -msg.message_id });
    if (used) { if (used.code !== "23505") throw used; await say(t.office.stale); return; }
    await botCall(token, "editMessageReplyMarkup", { chat_id, message_id: msg.message_id, reply_markup: { inline_keyboard: [] } }).catch(() => undefined);
  }
  const audit = (action: string, details: { [k: string]: string }) => db.from("audit_events").insert({ action, target_type: "office", target_id: office, details: details as never });
  try {
    switch (c.cmd) {
      case "menu": await home(); break;
      case "unknown": await home(); break;
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
          : `🏛 <b>Viongozi</b>\n\n${leaders}`, { reply_markup: officeBackKeyboard });
        break;
      }
      case "teua": {
        const { error } = await db.rpc("raisi_appoint", { _actor_tg: actor.id, _label: c.label, _slot: c.slot });
        if (error) throw new OfficeError(error.message);
        await say(`✅ ${esc(c.label)} ameteuliwa kuwa ${SLOT_TITLES[c.slot]} (nafasi ${c.slot}).`);
        break;
      }
      case "ondoa": {
        const { error } = await db.rpc("raisi_remove", { _actor_tg: actor.id, _slot: c.slot });
        if (error) throw new OfficeError(error.message);
        await say(`✅ Cheo cha nafasi ${c.slot} (${SLOT_TITLES[c.slot]}) kimeondolewa.`);
        break;
      }
      case "hamisha": {
        const { error } = await db.rpc("raisi_move", { _actor_tg: actor.id, _from: c.from, _to: c.to });
        if (error) throw new OfficeError(error.message);
        await say(`✅ Kiongozi wa nafasi ${c.from} sasa ni ${SLOT_TITLES[c.to]} (nafasi ${c.to}).`);
        break;
      }
      case "hotuba": {
        const { data: mem } = await db.from("members").select("id,public_identities(label)").eq("telegram_user_id", actor.id).single();
        const label = (mem?.public_identities as { label: string } | null)?.label;
        if (!mem || !label) throw new OfficeError("Akaunti ya Raisi haijapatikana");
        const { data: row, error } = await db.from("messages").insert({
          member_id: mem.id, sender_label: label, kind: "text", body: `👳🏾 HOTUBA YA RAISI\n\n${c.body}`,
          moderation_status: "pending", publication_status: "unpublished", processing_status: "awaiting_moderation",
        }).select("id").single();
        if (error) throw error;
        await audit("raisi.hotuba", { message_id: row.id });
        const { publishMessage } = await import("./telegram.server");
                await publishMessage(row.id);
        await say(t.office.speechDone, { reply_markup: officeBackKeyboard });
        break;
      }
    }
  } catch (e) {
    if (e instanceof OfficeError) { await say(`⚠️ ${esc(e.message)}`, { reply_markup: officeBackKeyboard }); return; }
    throw e;
  }
}
