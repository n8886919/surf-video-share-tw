import { describe, expect, it } from "vitest";
import {
  firstSelectableForecastHour,
  isWithinForecastWindow,
  isWithinUploadWindow,
  taipeiForecastDayOffset,
  taipeiForecastTarget,
} from "../packages/domain/src/time-policy";

describe("168-hour upload policy", () => {
  const now = new Date("2026-08-25T09:00:00.000Z"); // 17:00 in Taipei

  it("accepts the exact 168-hour boundary", () => {
    expect(isWithinUploadWindow("2026-08-18T09:00:00.000Z", now)).toBe(true);
  });

  it("rejects one millisecond beyond the boundary", () => {
    expect(isWithinUploadWindow("2026-08-18T08:59:59.999Z", now)).toBe(false);
  });

  it("rejects future and invalid timestamps", () => {
    expect(isWithinUploadWindow("2026-08-25T09:00:00.001Z", now)).toBe(false);
    expect(isWithinUploadWindow("not-a-date", now)).toBe(false);
  });

  it("accepts only capture hours from 05:00 through 17:59 in Taipei", () => {
    const afterWindow = new Date("2026-08-25T12:00:00.000Z");
    expect(isWithinUploadWindow("2026-08-25T05:00:00.000+08:00", afterWindow)).toBe(true);
    expect(isWithinUploadWindow("2026-08-25T17:59:59.999+08:00", afterWindow)).toBe(true);
    expect(isWithinUploadWindow("2026-08-25T04:59:59.999+08:00", afterWindow)).toBe(false);
    expect(isWithinUploadWindow("2026-08-24T18:00:00.000+08:00", afterWindow)).toBe(false);
  });
});

describe("Taipei calendar-day forecast query policy", () => {
  const now = new Date("2026-08-25T06:30:00.000Z"); // 14:30 in Taipei

  it("accepts whole hours from today through calendar day offset four", () => {
    expect(isWithinForecastWindow("2026-08-25T07:00:00.000Z", now)).toBe(true);
    expect(isWithinForecastWindow("2026-08-29T09:00:00.000Z", now)).toBe(true);
  });

  it("rejects past times, minutes, and hours outside 05:00–17:00", () => {
    expect(isWithinForecastWindow("2026-08-25T06:00:00.000Z", now)).toBe(false);
    expect(isWithinForecastWindow("2026-08-25T07:30:00.000Z", now)).toBe(false);
    expect(isWithinForecastWindow("2026-08-25T10:00:00.000Z", now)).toBe(false);
    expect(isWithinForecastWindow("2026-08-25T06:59:59.999Z", now)).toBe(false);
  });

  it("rejects calendar day offset five and invalid timestamps", () => {
    expect(isWithinForecastWindow("2026-08-30T05:00:00.000+08:00", now)).toBe(false);
    expect(isWithinForecastWindow("not-a-date", now)).toBe(false);
  });

  it("constructs targets from Taipei calendar fields independent of browser time zone", () => {
    expect(taipeiForecastTarget(0, 17, now).toISOString()).toBe("2026-08-25T09:00:00.000Z");
    expect(taipeiForecastTarget(4, 5, now).toISOString()).toBe("2026-08-28T21:00:00.000Z");
    expect(taipeiForecastDayOffset("2026-08-28T21:00:00.000Z", now)).toBe(4);
    expect(firstSelectableForecastHour(0, now)).toBe(15);
    expect(firstSelectableForecastHour(1, now)).toBe(5);
  });

  it("moves the first selectable day forward after the daily window closes", () => {
    const afterHours = new Date("2026-08-25T09:01:00.000Z");
    expect(firstSelectableForecastHour(0, afterHours)).toBeNull();
    expect(firstSelectableForecastHour(1, afterHours)).toBe(5);
  });
});
