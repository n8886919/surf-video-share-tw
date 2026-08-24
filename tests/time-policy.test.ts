import { describe, expect, it } from "vitest";
import { isTodayInTaipei } from "../packages/domain/src/time-policy";

describe("Asia/Taipei today-only policy", () => {
  it("accepts exactly 00:00 in Taipei", () => {
    const now = new Date("2026-08-24T01:00:00.000Z");
    expect(isTodayInTaipei("2026-08-23T16:00:00.000Z", now)).toBe(true);
  });

  it("rejects 23:59:59 from the previous Taipei date", () => {
    const now = new Date("2026-08-24T01:00:00.000Z");
    expect(isTodayInTaipei("2026-08-23T15:59:59.000Z", now)).toBe(false);
  });

  it("accepts 23:59:59 at the end of the same Taipei date", () => {
    const now = new Date("2026-08-24T15:59:59.000Z");
    expect(isTodayInTaipei("2026-08-24T15:59:59.000Z", now)).toBe(true);
  });

  it("rejects a future capture even on the same Taipei date", () => {
    const now = new Date("2026-08-24T01:00:00.000Z");
    expect(isTodayInTaipei("2026-08-24T02:00:00.000Z", now)).toBe(false);
  });

  it("rejects invalid timestamps", () => {
    expect(isTodayInTaipei("not-a-date")).toBe(false);
  });
});
