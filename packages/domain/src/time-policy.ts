export const PRODUCT_TIME_ZONE = "Asia/Taipei";
export const UPLOAD_WINDOW_HOURS = 7 * 24;
export const FORECAST_LOOKAHEAD_HOURS = 72;
export const FORECAST_PAST_TOLERANCE_MINUTES = 5;

export function isWithinUploadWindow(
  capturedAt: string | Date,
  now = new Date(),
  windowHours = UPLOAD_WINDOW_HOURS,
): boolean {
  const captured = capturedAt instanceof Date ? capturedAt : new Date(capturedAt);
  if (Number.isNaN(captured.getTime()) || !Number.isFinite(windowHours) || windowHours < 0) {
    return false;
  }
  const ageMs = now.getTime() - captured.getTime();
  return ageMs >= 0 && ageMs <= windowHours * 60 * 60 * 1000;
}

export function assertWithinUploadWindow(capturedAt: string, now = new Date()): void {
  if (!isWithinUploadWindow(capturedAt, now)) {
    throw new Error("影片拍攝時間不可晚於現在，且必須在 168 小時內");
  }
}

export function isWithinForecastWindow(
  targetTime: string | Date,
  now = new Date(),
  lookaheadHours = FORECAST_LOOKAHEAD_HOURS,
): boolean {
  const target = targetTime instanceof Date ? targetTime : new Date(targetTime);
  if (Number.isNaN(target.getTime()) || !Number.isFinite(lookaheadHours) || lookaheadHours < 0) {
    return false;
  }
  const offsetMs = target.getTime() - now.getTime();
  return offsetMs >= -FORECAST_PAST_TOLERANCE_MINUTES * 60_000
    && offsetMs <= lookaheadHours * 60 * 60_000;
}

export function assertWithinForecastWindow(targetTime: string, now = new Date()): void {
  if (!isWithinForecastWindow(targetTime, now)) {
    throw new Error("查詢時間必須是現在至未來 72 小時內");
  }
}
