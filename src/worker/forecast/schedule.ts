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
