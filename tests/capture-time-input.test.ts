import { describe, expect, it } from "vitest";
import { captureDateOptions } from "../app/capture-time-input";

describe("Taipei capture-date choices", () => {
  it("starts on last Tuesday when today is Monday, excluding the partial seventh day", () => {
    expect(captureDateOptions(new Date("2026-09-14T06:15:00Z"))).toEqual([
      "2026-09-08", "2026-09-09", "2026-09-10", "2026-09-11", "2026-09-12", "2026-09-13", "2026-09-14",
    ]);
  });
  it("keeps seven Taipei calendar dates across a year and leap day", () => {
    expect(captureDateOptions(new Date("2026-01-04T06:15:00Z"))).toEqual([
      "2025-12-29", "2025-12-30", "2025-12-31", "2026-01-01", "2026-01-02", "2026-01-03", "2026-01-04",
    ]);
    expect(captureDateOptions(new Date("2028-03-01T11:59:00Z"))).toEqual([
      "2028-02-24", "2028-02-25", "2028-02-26", "2028-02-27", "2028-02-28", "2028-02-29", "2028-03-01",
    ]);
  });
  it("omits today before 05:00 Taipei without offering an older day instead", () => {
    expect(captureDateOptions(new Date("2026-09-13T20:59:59Z"))).toEqual([
      "2026-09-08", "2026-09-09", "2026-09-10", "2026-09-11", "2026-09-12", "2026-09-13",
    ]);
    expect(captureDateOptions(new Date("2026-09-13T21:00:00Z"))).toHaveLength(7);
    expect(captureDateOptions(new Date("invalid"))).toEqual([]);
  });
});
