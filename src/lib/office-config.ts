// Browser-safe office definitions shared by the web panel and the office bots.
export type OfficeKey = "raisi" | "mbunge" | "polisi" | "mwenyekiti" | "ulinzi";

export const SLOT_TITLES: Record<number, string> = {
  1: "👳🏾 Raisi", 2: "🧑🏾‍⚖️ Mbunge", 3: "💂🏾 Mgambo", 4: "🧑🏾‍🦱 Mjumbe", 5: "🚔 Polisi",
  6: "💂🏾 Mgambo", 7: "🪑 Mwenyekiti", 8: "🧑🏾‍🦱 Mjumbe", 9: "💂🏾 Mgambo",
};

export const OFFICES: { key: OfficeKey; title: string; slots: number[]; ready: boolean }[] = [
  { key: "raisi", title: "👳🏾 Ofisi ya Raisi", slots: [1], ready: true },
  { key: "mbunge", title: "🧑🏾‍⚖️ Ofisi ya Mbunge", slots: [2], ready: false },
  { key: "polisi", title: "🚔 Ofisi ya Polisi", slots: [5], ready: false },
  { key: "mwenyekiti", title: "🪑 Ofisi ya Mwenyekiti", slots: [7], ready: false },
  { key: "ulinzi", title: "💂🏾 Wajumbe na Wagambo", slots: [3, 4, 6, 8, 9], ready: false },
];

export function isOfficeKey(v: string): v is OfficeKey {
  return OFFICES.some((o) => o.key === v);
}
