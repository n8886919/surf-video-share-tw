import { describe, expect, it } from "vitest";
import {
  isWithinForecastWindow,
  isWithinUploadWindow,
} from "../packages/domain/src/time-policy";

describe("168-hour upload policy", () => {
  const now = new Date("2026-08-25T12:00:00.000Z");

  it("accepts the exact 168-hour boundary", () => {
    expect(isWithinUploadWindow("2026-08-18T12:00:00.000Z", now)).toBe(true);
  });

  it("rejects one millisecond beyond the boundary", () => {
    expect(isWithinUploadWindow("2026-08-18T11:59:59.999Z", now)).toBe(false);
  });

  it("rejects future and invalid timestamps", () => {
    expect(isWithinUploadWindow("2026-08-25T12:00:00.001Z", now)).toBe(false);
    expect(isWithinUploadWindow("not-a-date", now)).toBe(false);
  });
});

describe("72-hour forecast query policy", () => {
  const now = new Date("2026-08-25T12:00:00.000Z");

  it("accepts now and the exact 72-hour boundary", () => {
    expect(isWithinForecastWindow(now, now)).toBe(true);
    expect(isWithinForecastWindow("2026-08-28T12:00:00.000Z", now)).toBe(true);
  });

  it("allows only the current input minute as clock tolerance", () => {
    expect(isWithinForecastWindow("2026-08-25T11:55:00.000Z", now)).toBe(true);
    expect(isWithinForecastWindow("2026-08-25T11:54:59.999Z", now)).toBe(false);
  });

  it("rejects targets beyond 72 hours and invalid timestamps", () => {
    expect(isWithinForecastWindow("2026-08-28T12:00:00.001Z", now)).toBe(false);
    expect(isWithinForecastWindow("not-a-date", now)).toBe(false);
  });
});
