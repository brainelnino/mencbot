import { t } from "./i18n";
import { SLOT_TITLES } from "./office-config";

export type RaisiCommand =
  | { cmd: "menu" | "ripoti" | "viongozi" }
  | { cmd: "teua"; label: string; slot: number }
  | { cmd: "ondoa"; slot: number }
  | { cmd: "hamisha"; from: number; to: number }
  | { cmd: "hotuba"; body: string }
  | { cmd: "prompt"; action: "teua" | "ondoa" | "hamisha" | "hotuba" }
  | { cmd: "unknown" };

export function parseRaisiCommand(text: string): RaisiCommand {
  const s = text.trim();
  const m = /^\/?([a-z]+)(?:@\w+)?(?:\s+([\s\S]*))?$/i.exec(s);
  if (!m?.[1]) return { cmd: "unknown" };
  const name = m[1].toLowerCase(), args = m[2]?.trim() ?? "";
  if (["start", "menu", "admin", "help", "msaada"].includes(name)) return { cmd: "menu" };
  if ((name === "ripoti" || name === "viongozi") && !args) return { cmd: name };
  if (["teua", "ondoa", "hamisha", "hotuba"].includes(name) && !args) return { cmd: "prompt", action: name as "teua" | "ondoa" | "hamisha" | "hotuba" };
  const parts = args.split(/\s+/);
  if (name === "teua" && parts.length === 2 && /^[a-z]|\d+$/i.test(parts[0] ?? "") && /^(?:[A-Za-z]|\d{2,10})$/.test(parts[0] ?? "") && /^[2-9]$/.test(parts[1] ?? "")) return { cmd: "teua", label: (parts[0] ?? "").toUpperCase(), slot: Number(parts[1]) };
  if (name === "ondoa" && /^[2-9]$/.test(args)) return { cmd: "ondoa", slot: Number(args) };
  if (name === "hamisha" && parts.length === 2 && parts.every((p) => /^[2-9]$/.test(p)) && parts[0] !== parts[1]) return { cmd: "hamisha", from: Number(parts[0]), to: Number(parts[1]) };
  if (name === "hotuba" && args.length >= 2 && args.length <= 3500) return { cmd: "hotuba", body: args };
  return { cmd: "unknown" };
}

const button = (text: string, data: string) => ({ text, callback_data: `o:${data}` });
export const officeHomeKeyboard = { inline_keyboard: [
  [button(t.office.report, "ripoti"), button(t.office.leaders, "viongozi")],
  [button(t.office.appoint, "teua"), button(t.office.remove, "ondoa")],
  [button(t.office.move, "hamisha"), button(t.office.speech, "hotuba")],
] };
export const officeBackKeyboard = { inline_keyboard: [[button(t.office.back, "menu")]] };
export function officeSlotsKeyboard(action: string, exclude?: number) {
  const buttons = Array.from({ length: 8 }, (_, i) => i + 2).filter((s) => s !== exclude).map((s) => button(`${s} · ${SLOT_TITLES[s]}`, `${action}:${s}`));
  return { inline_keyboard: [...buttons.map((b) => [b]), [button(t.office.cancel, "menu")]] };
}
export function officeConfirmKeyboard(action: string, speech = false) {
  return { inline_keyboard: [[button(speech ? t.office.send : t.office.confirm, `confirm:${action}`)], [button(t.office.cancel, "menu")]] };
}

export function parseOfficeCallback(data: string): RaisiCommand | { cmd: "choose"; action: "teua" | "ondoa" | "hamisha"; slot: number } | { cmd: "destination"; from: number; to: number } | { cmd: "confirmSpeech" } {
  if (!data.startsWith("o:")) return { cmd: "unknown" };
  const s = data.slice(2);
  if (s === "confirm:hotuba") return { cmd: "confirmSpeech" };
  if (s.startsWith("confirm:")) return parseRaisiCommand(s.slice(8).replaceAll(":", " "));
  const m = /^(teua|ondoa|hamisha):([2-9])$/.exec(s);
  if (m?.[1] && m[2]) return { cmd: "choose", action: m[1] as "teua" | "ondoa" | "hamisha", slot: Number(m[2]) };
  const dest = /^to:([2-9]):([2-9])$/.exec(s);
  if (dest && dest[1] !== dest[2]) return { cmd: "destination", from: Number(dest[1]), to: Number(dest[2]) };
  // Only read-only commands and workflow entry points are accepted without confirmation.
  const c = parseRaisiCommand(s);
  return ["menu", "ripoti", "viongozi", "prompt"].includes(c.cmd) ? c : { cmd: "unknown" };
}