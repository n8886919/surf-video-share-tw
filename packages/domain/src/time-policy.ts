export const PRODUCT_TIME_ZONE = "Asia/Taipei";
export const UPLOAD_WINDOW_HOURS = 7 * 24;
export const COMPOSITE_FORECAST_DAY_OFFSET_MAX = 2;
export const FORECAST_DAY_OFFSET_MAX = 4;
export const FORECAST_HOUR_MIN = 5;
export const FORECAST_HOUR_MAX = 17;

interface TaipeiDateTimeParts {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
}

const taipeiDateTimeFormatter = new Intl.DateTimeFormat("en-CA", {
  timeZone: PRODUCT_TIME_ZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hourCycle: "h23",
});

function taipeiParts(date: Date): TaipeiDateTimeParts | null {
  if (!Number.isFinite(date.getTime())) return null;
  const values = Object.fromEntries(
    taipeiDateTimeFormatter.formatToParts(date)
      .filter((part) => part.type !== "literal")
      .map((part) => [part.type, Number(part.value)]),
  );
  const { year, month, day, hour, minute, second } = values;
  return [year, month, day, hour, minute, second].every(Number.isFinite)
    ? { year, month, day, hour, minute, second }
    : null;
}

function calendarDayNumber(parts: Pick<TaipeiDateTimeParts, "year" | "month" | "day">): number {
  return Date.UTC(parts.year, parts.month - 1, parts.day) / 86_400_000;
}

export function taipeiForecastTarget(
  dayOffset: number,
  hour: number,
  now = new Date(),
): Date {
  const current = taipeiParts(now);
  if (!current
    || !Number.isInteger(dayOffset)
    || dayOffset < 0
    || dayOffset > FORECAST_DAY_OFFSET_MAX
    || !Number.isInteger(hour)
    || hour < FORECAST_HOUR_MIN
    || hour > FORECAST_HOUR_MAX) {
    return new Date(Number.NaN);
  }
  // Taiwan has used UTC+08:00 without daylight-saving changes since 1979. The
  // explicit offset converts the selected Asia/Taipei calendar fields to UTC.
  return new Date(Date.UTC(current.year, current.month - 1, current.day + dayOffset, hour - 8));
}

export function firstSelectableForecastHour(dayOffset: number, now = new Date()): number | null {
  for (let hour = FORECAST_HOUR_MIN; hour <= FORECAST_HOUR_MAX; hour += 1) {
    const target = taipeiForecastTarget(dayOffset, hour, now);
    if (Number.isFinite(target.getTime()) && target.getTime() >= now.getTime()) return hour;
  }
  return null;
}

export function isWithinUploadWindow(
  capturedAt: string | Date,
  now = new Date(),
  windowHours = UPLOAD_WINDOW_HOURS,
): boolean {
  const captured = capturedAt instanceof Date ? capturedAt : new Date(capturedAt);
  const capturedParts = taipeiParts(captured);
  if (!capturedParts || !Number.isFinite(windowHours) || windowHours < 0) {
    return false;
  }
  const ageMs = now.getTime() - captured.getTime();
  return ageMs >= 0
    && ageMs <= windowHours * 60 * 60 * 1000
    && capturedParts.hour >= FORECAST_HOUR_MIN
    && capturedParts.hour <= FORECAST_HOUR_MAX;
}

export function assertWithinUploadWindow(capturedAt: string, now = new Date()): void {
  if (!isWithinUploadWindow(capturedAt, now)) {
    throw new Error("影片拍攝時間不可晚於現在、必須在 168 小時內，且台北時間須介於 05:00–17:59");
  }
}

export function isWithinForecastWindow(
  targetTime: string | Date,
  now = new Date(),
): boolean {
  const target = targetTime instanceof Date ? targetTime : new Date(targetTime);
  const targetParts = taipeiParts(target);
  const dayOffset = taipeiForecastDayOffset(target, now);
  if (!targetParts || dayOffset === null || target.getUTCMilliseconds() !== 0) return false;
  return target.getTime() >= now.getTime()
    && dayOffset >= 0
    && dayOffset <= FORECAST_DAY_OFFSET_MAX
    && targetParts.hour >= FORECAST_HOUR_MIN
    && targetParts.hour <= FORECAST_HOUR_MAX
    && targetParts.minute === 0
    && targetParts.second === 0;
}

export function taipeiForecastDayOffset(
  targetTime: string | Date,
  now = new Date(),
): number | null {
  const target = targetTime instanceof Date ? targetTime : new Date(targetTime);
  const targetParts = taipeiParts(target);
  const nowParts = taipeiParts(now);
  if (!targetParts || !nowParts) return null;
  return calendarDayNumber(targetParts) - calendarDayNumber(nowParts);
}

export function assertWithinForecastWindow(targetTime: string, now = new Date()): void {
  if (!isWithinForecastWindow(targetTime, now)) {
    throw new Error("查詢時間必須是台北時間今天起五天內的 05:00–17:00 整點，且不可早於現在");
  }
}
