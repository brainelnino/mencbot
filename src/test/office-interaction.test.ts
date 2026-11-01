import { describe, expect, it } from "vitest";
import { parseOfficeCallback } from "@/lib/office-interaction";

describe("Office button workflow", () => {
  it("opens appointment selection", () => expect(parseOfficeCallback("o:teua")).toEqual({ cmd: "prompt", action: "teua" }));
  it("selects slot 3 for appointment", () => expect(parseOfficeCallback("o:teua:3")).toEqual({ cmd: "choose", action: "teua", slot: 3 }));
  it("confirms appointment of F into slot 3", () => expect(parseOfficeCallback("o:confirm:teua:F:3")).toEqual({ cmd: "teua", label: "F", slot: 3 }));
  it("requires confirmation before removal", () => expect(parseOfficeCallback("o:ondoa:5")).toEqual({ cmd: "choose", action: "ondoa", slot: 5 }));
  it("rejects slot 1 selection", () => expect(parseOfficeCallback("o:ondoa:1")).toEqual({ cmd: "unknown" }));
  it("rejects unconfirmed mutation", () => expect(parseOfficeCallback("o:teua F 3")).toEqual({ cmd: "unknown" }));
  it("selects move destination", () => expect(parseOfficeCallback("o:to:3:6")).toEqual({ cmd: "destination", from: 3, to: 6 }));
  it("rejects moving to same slot", () => expect(parseOfficeCallback("o:to:3:3")).toEqual({ cmd: "unknown" }));
});