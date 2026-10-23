import { describe, it, expect } from "vitest";
import { hasBlockedContent } from "@/lib/telegram-parse";

describe("hasBlockedContent", () => {
  it.each(["716764289", "0716764289", "+255716764289", "+1 (415) 555-2671", "piga 0716 764 289"])("blocks phone %s", (t) => expect(hasBlockedContent(t)).toBe(true));
  it.each(["https://x.com", "www.google.com", "t.me/kundi", "tembelea elnino.tz"])("blocks link %s", (t) => expect(hasBlockedContent(t)).toBe(true));
  it.each(["Habari za leo?", "Tukutane saa 10 jioni", "Bei ni 25000"])("allows %s", (t) => expect(hasBlockedContent(t)).toBe(false));
});
