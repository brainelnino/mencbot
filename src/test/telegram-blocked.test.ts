import { describe, it, expect } from "vitest";
import { findBlockedTerm, hasBlockedContent } from "@/lib/telegram-parse";

describe("hasBlockedContent", () => {
  it.each(["716764289", "0716764289", "+255716764289", "+1 (415) 555-2671", "piga 0716 764 289"])("blocks phone %s", (t) => expect(hasBlockedContent(t)).toBe(true));
  it.each(["https://x.com", "www.google.com", "t.me/kundi", "tembelea elnino.tz"])("blocks link %s", (t) => expect(hasBlockedContent(t)).toBe(true));
  it.each(["Habari za leo?", "Tukutane saa 10 jioni", "Bei ni 25000"])("allows %s", (t) => expect(hasBlockedContent(t)).toBe(false));
});

describe("findBlockedTerm", () => {
  const terms = ["matusi", "neno baya"];
  it("blocks a whole-word term", () => expect(findBlockedTerm("haya matusi hayo", terms)).toBe("matusi"));
  it("is case-insensitive", () => expect(findBlockedTerm("MATUSI yote", terms)).toBe("matusi"));
  it("blocks a multi-word term", () => expect(findBlockedTerm("hilo ni neno baya sana", terms)).toBe("neno baya"));
  it("does not match inside another word", () => expect(findBlockedTerm("mbaya sana", ["baya"])).toBeNull());
  it("allows clean text", () => expect(findBlockedTerm("Habari za leo?", terms)).toBeNull());
  it("allows everything when no terms exist", () => expect(findBlockedTerm("matusi", [])).toBeNull());
});
