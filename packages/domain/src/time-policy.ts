export const PRODUCT_TIME_ZONE = "Asia/Taipei";

function dateKey(date: Date): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: PRODUCT_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const value = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((part) => part.type === type)?.value ?? "";
  return `${value("year")}-${value("month")}-${value("day")}`;
}

export function isTodayInTaipei(capturedAt: string | Date, now = new Date()): boolean {
  const captured = capturedAt instanceof Date ? capturedAt : new Date(capturedAt);
  if (Number.isNaN(captured.getTime())) return false;
  return dateKey(captured) === dateKey(now) && captured.getTime() <= now.getTime();
}

export function assertTodayInTaipei(capturedAt: string, now = new Date()): void {
  if (!isTodayInTaipei(capturedAt, now)) {
    throw new Error("影片拍攝時間必須是台北時區的今天，且不可晚於現在");
  }
}
