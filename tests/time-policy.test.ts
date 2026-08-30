import { describe, expect, it } from "vitest";
import {
  firstSelectableForecastHour,
  isWithinForecastWindow,
  isWithinUploadWindow,
  taipeiForecastTarget,
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

describe("Taipei calendar-day forecast query policy", () => {
  const now = new Date("2026-08-25T10:30:00.000Z"); // 18:30 in Taipei

  it("accepts whole hours from today through calendar day offset six", () => {
    expect(isWithinForecastWindow("2026-08-25T11:00:00.000Z", now)).toBe(true);
    expect(isWithinForecastWindow("2026-08-31T11:00:00.000Z", now)).toBe(true);
  });

  it("rejects past times, minutes, and hours outside 05:00–19:00", () => {
    expect(isWithinForecastWindow("2026-08-25T10:00:00.000Z", now)).toBe(false);
    expect(isWithinForecastWindow("2026-08-25T11:30:00.000Z", now)).toBe(false);
    expect(isWithinForecastWindow("2026-08-25T20:00:00.000Z", now)).toBe(false);
    expect(isWithinForecastWindow("2026-08-25T10:59:59.999Z", now)).toBe(false);
  });

  it("rejects calendar day offset seven and invalid timestamps", () => {
    expect(isWithinForecastWindow("2026-09-01T05:00:00.000+08:00", now)).toBe(false);
    expect(isWithinForecastWindow("not-a-date", now)).toBe(false);
  });

  it("constructs targets from Taipei calendar fields independent of browser time zone", () => {
    expect(taipeiForecastTarget(0, 19, now).toISOString()).toBe("2026-08-25T11:00:00.000Z");
    expect(taipeiForecastTarget(6, 5, now).toISOString()).toBe("2026-08-30T21:00:00.000Z");
    expect(firstSelectableForecastHour(0, now)).toBe(19);
    expect(firstSelectableForecastHour(1, now)).toBe(5);
  });

  it("moves the first selectable day forward after the daily window closes", () => {
    const afterHours = new Date("2026-08-25T12:01:00.000Z");
    expect(firstSelectableForecastHour(0, afterHours)).toBeNull();
    expect(firstSelectableForecastHour(1, afterHours)).toBe(5);
  });
});
