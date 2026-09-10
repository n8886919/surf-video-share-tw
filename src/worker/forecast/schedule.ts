export type ForecastSource = "cwa" | "mfwam" | "mfwam_far";

/** Only trusted scheduled minutes qualify; seconds are not a separate run. */
export function canonicalForecastSlot(source: ForecastSource, value: string): string | null {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime()) || date.getUTCHours() % (source === "mfwam_far" ? 12 : 6) !== 0
    || date.getUTCMinutes() !== (source === "cwa" ? 0 : 20)) return null;
  // CWA is an upstream model identity, not a jittered Cron invocation.
  if (source === "cwa" && (date.getUTCSeconds() !== 0 || date.getUTCMilliseconds() !== 0)) return null;
  date.setUTCSeconds(0, 0);
  return date.toISOString();
}

/** Fifteen minutes of completion grace, evaluated at the server's check time. */
export function latestDueMfwamSlot(now: Date, far = false): string {
  const interval = (far ? 12 : 6) * 3_600_000;
  const offset = 20 * 60_000;
  return new Date(Math.floor((now.getTime() - offset - 15 * 60_000) / interval) * interval + offset).toISOString();
}

/** Existing UTC 00/06/12/18 Cron: retain the recent past on every collection. */
export function isFarForecastSlot(date: Date): boolean {
  return date.getUTCHours() % 12 === 0;
}

export function mfwamForecastHours(date: Date, far = isFarForecastSlot(date)): number {
  // Five Taipei dates plus the overnight rollover until the next full collection.
  if (far) return 126;
  const taipeiHour = (date.getUTCHours() + 8) % 24;
  // Through tomorrow 23:00, retaining neighbours of the last selectable 19:00.
  return 48 - taipeiHour;
}
