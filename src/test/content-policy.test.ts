import { describe, expect, it } from "vitest";
import { contentRejection, DEFAULT_POLICY, parsePolicy } from "@/lib/content-policy";
import { classifyUpdate, hasLink, hasPhone } from "@/lib/telegram-parse";

describe("content policy", () => {
  it("blocks photos when photos are off", () => expect(contentRejection(DEFAULT_POLICY, false, "photo", false, false)).toBe("media"));
  it("allows photos when photos are on", () => expect(contentRejection({ ...DEFAULT_POLICY, photo: true }, false, "photo", false, false)).toBeNull());
  it("blocks links by default", () => expect(contentRejection(DEFAULT_POLICY, false, null, true, false)).toBe("link"));
  it("allows phones when phones are on", () => expect(contentRejection({ ...DEFAULT_POLICY, phones: true }, false, null, false, true)).toBeNull());
  it("exempt member can send blocked things", () => expect(contentRejection(DEFAULT_POLICY, true, "document", true, true)).toBeNull());
  it("parses stored values", () => expect(parsePolicy({ video: true }).video).toBe(true));
  it("detects link and phone separately", () => { expect(hasLink("ona www.x.com")).toBe(true); expect(hasLink("0716764289")).toBe(false); expect(hasPhone("0716764289")).toBe(true); });
  it("classifies a photo with caption", () => {
    const c = classifyUpdate({ update_id: 1, message: { message_id: 5, from: { id: 9 }, chat: { id: 9, type: "private" }, photo: [{}], caption: "hi" } });
    expect(c).toMatchObject({ kind: "private_media", media: "photo", text: "hi" });
  });
});
