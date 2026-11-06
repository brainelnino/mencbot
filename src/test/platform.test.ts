import { describe, expect, it } from "vitest";
import { isToken, togglePolicy, MAX_BOTS_PER_OWNER } from "@/lib/platform-parse";
import { DEFAULT_POLICY } from "@/lib/content-policy";

describe("platform bot", () => {
  it("each owner may connect only one bot for now", () => expect(MAX_BOTS_PER_OWNER).toBe(1));
  it("accepts a BotFather token", () => expect(isToken("123456789:AAHdqTcvCH1vGWJxfSeofSAs0K5PALDsaw")).toBe(true));
  it("rejects ordinary text as token", () => expect(isToken("habari yako")).toBe(false));
  it("toggling photos allows them", () => expect(togglePolicy(DEFAULT_POLICY, "photo").photo).toBe(true));
});
