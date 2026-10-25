import { describe, expect, it } from "vitest";
import { parseRaisiCommand } from "@/lib/office.server";
import { OFFICES } from "@/lib/office-config";

describe("Raisi office commands", () => {
  it("parses appoint by ID and slot", () => expect(parseRaisiCommand("/teua f 3")).toEqual({ cmd: "teua", label: "F", slot: 3 }));
  it("parses removal of a slot", () => expect(parseRaisiCommand("/ondoa 5")).toEqual({ cmd: "ondoa", slot: 5 }));
  it("parses moving a leader", () => expect(parseRaisiCommand("/hamisha 3 6")).toEqual({ cmd: "hamisha", from: 3, to: 6 }));
  it("parses a speech", () => expect(parseRaisiCommand("/hotuba Habari jamii")).toEqual({ cmd: "hotuba", body: "Habari jamii" }));
  it("rejects malformed appoint", () => expect(parseRaisiCommand("/teua 3")).toEqual({ cmd: "unknown" }));
  it("Raisi office belongs only to slot 1", () => expect(OFFICES.find((o) => o.key === "raisi")?.slots).toEqual([1]));
  it("Mjumbe and Mgambo share one bot for slots 3,4,6,8,9", () => expect(OFFICES.find((o) => o.key === "ulinzi")?.slots).toEqual([3, 4, 6, 8, 9]));
});
