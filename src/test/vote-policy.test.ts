import { describe, expect, it } from "vitest";
import { parseVotePolicy, votesEnabled } from "@/lib/vote-policy";

describe("owner vote button controls", () => {
  it("disables all buttons when both switches are off", () => {
    const policy = parseVotePolicy({ text: false, media: false });
    expect(votesEnabled(policy, null)).toBe(false);
    expect(votesEnabled(policy, "photo")).toBe(false);
  });
  it("allows photo buttons while text buttons are off", () => {
    const policy = parseVotePolicy({ text: false, media: true });
    expect(votesEnabled(policy, null)).toBe(false);
    expect(votesEnabled(policy, "photo")).toBe(true);
  });
  it("keeps existing behavior until the owner changes settings", () => {
    expect(parseVotePolicy(null)).toEqual({ text: true, media: true });
  });
});