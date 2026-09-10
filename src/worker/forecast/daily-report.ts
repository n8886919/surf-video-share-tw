import type { AppEnv } from "../db";
import { LineNotificationError, sendLineNotification } from "../ops-observability";
import { canonicalForecastSlot, type ForecastSource } from "./schedule";
import { readCompletedForecastSlots } from "./update-runs";

const HOUR_MS = 3_600_000;
const CLAIM_TIMEOUT_MS = 5 * 60_000;

export async function recordForecastUpdate(
  db: D1Database,
  source: ForecastSource,
  slotAt: string,
  completed: boolean,
  now = new Date(),
): Promise<void> {
  // CWA records the exact supplied model identity; only our Cron slots jitter.
  const slot = source === "cwa" ? new Date(slotAt).toISOString() : canonicalForecastSlot(source, slotAt);
  if (!slot) return;
  await db.prepare(
    `INSERT INTO forecast_update_runs (run_key, source, slot_at, started_at, completed_at)
     VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(source, slot_at) DO UPDATE SET
       completed_at = COALESCE(forecast_update_runs.completed_at, excluded.completed_at)`,
  ).bind(`${source}:${slot}`, source, slot, now.toISOString(), completed ? now.toISOString() : null).run();
}

function taipeiDay(date: Date): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Taipei", year: "numeric", month: "2-digit", day: "2-digit",
  }).format(date);
}

// CWA: upstream 00/06/12/18 UTC model runs. MFWAM: our :20 six-hour Cron slots.
// These are operational counts; Open-Meteo model_run_at remains unknown/null.
export function expectedForecastSlots(day: string, source: ForecastSource): string[] {
  const start = Date.parse(`${day}T00:00:00+08:00`);
  return (source === "mfwam_far" ? [8, 20] : [2, 8, 14, 20]).map(hour =>
    new Date(start + hour * HOUR_MS + (source !== "cwa" ? 20 * 60_000 : 0)).toISOString(),
  );
}

interface DailyReportRow {
  message: string;
  recipient_hash: string;
  retry_key: string;
  status: string;
}

async function completedSlots(db: D1Database, day: string, source: ForecastSource): Promise<number> {
  const slots = expectedForecastSlots(day, source);
  return (await readCompletedForecastSlots(db, source, slots)).size;
}

/** Called by the existing hourly :05 task. Retry only during the same Taipei day. */
export async function runDailyForecastReport(
  env: AppEnv,
  scheduledAt: Date,
  fetchImpl: typeof fetch = fetch,
): Promise<void> {
  const now = new Date();
  const today = taipeiDay(now);
  // Ignore delayed/replayed cron events from another day or before today's 09:05.
  if (taipeiDay(scheduledAt) !== today
    || now.getTime() < Date.parse(`${today}T09:05:00+08:00`)
    || scheduledAt.getTime() < Date.parse(`${today}T09:05:00+08:00`)) return;

  const day = taipeiDay(new Date(Date.parse(`${today}T00:00:00+08:00`) - 1));
  const dayStart = `${day}T00:00:00+08:00`;
  const tracking = await env.DB.prepare(
    `SELECT started_at FROM forecast_update_runs
     WHERE source = 'mfwam' ORDER BY slot_at LIMIT 1`,
  ).first<{ started_at: string }>();
  // The first instrumented attempt establishes coverage, even when fetching fails.
  // Skip the partial launch day; never infer past successes from snapshot counts.
  if (!tracking || Date.parse(tracking.started_at) > Date.parse(dayStart)) return;

  if (!env.LINE_MESSAGING_CHANNEL_ACCESS_TOKEN || !/^U[0-9a-f]{32}$/iu.test(env.OPS_LINE_USER_ID ?? "")) {
    throw new Error("Daily forecast LINE configuration unavailable");
  }
  const recipientHash = Array.from(new Uint8Array(await crypto.subtle.digest(
    "SHA-256", new TextEncoder().encode(env.OPS_LINE_USER_ID),
  )), byte => byte.toString(16).padStart(2, "0")).join("");
  let report = await env.DB.prepare(
    `SELECT message, recipient_hash, retry_key, status FROM forecast_daily_reports WHERE report_day = ?`,
  ).bind(day).first<DailyReportRow>();
  if (!report) {
    const cwa = await completedSlots(env.DB, day, "cwa");
    const mfwam = await completedSlots(env.DB, day, "mfwam");
    const farTracking = await env.DB.prepare("SELECT started_at FROM forecast_update_runs WHERE source = 'mfwam_far' ORDER BY slot_at LIMIT 1").first<{ started_at: string }>();
    const far = farTracking && Date.parse(farTracking.started_at) <= Date.parse(dayStart)
      ? await completedSlots(env.DB, day, "mfwam_far") : null;
    const message = [
      `昨日預報更新（${day}）`,
      `CWA：應更新 4 次，成功 ${cwa} 次`,
      `MFWAM 近兩天：應更新 4 次，成功 ${mfwam} 次`,
      far === null ? "MFWAM 後三天：尚未累積完整一天" : `MFWAM 後三天：應更新 2 次，成功 ${far} 次`,
      "成功指全浪點收錄完成（含相同資料），不是官方發布新版本次數。",
    ].join("\n");
    await env.DB.prepare(
      `INSERT OR IGNORE INTO forecast_daily_reports
       (report_day, message, recipient_hash, retry_key, status, created_at)
       VALUES (?, ?, ?, ?, 'pending', ?)`,
    ).bind(day, message, recipientHash, crypto.randomUUID(), now.toISOString()).run();
    report = await env.DB.prepare(
      `SELECT message, recipient_hash, retry_key, status FROM forecast_daily_reports WHERE report_day = ?`,
    ).bind(day).first<DailyReportRow>();
  }
  if (!report) throw new Error("Daily forecast report was not persisted");
  if (report.status === "sent" || report.status === "rejected") return;
  // LINE requires identical content and recipient for all uses of one retry key.
  if (report.recipient_hash !== recipientHash) throw new Error("Daily forecast recipient changed during retry");
  const claimToken = crypto.randomUUID();
  const claim = await env.DB.prepare(
    `UPDATE forecast_daily_reports SET status = 'sending', claim_token = ?, claimed_at = ?
     WHERE report_day = ? AND status NOT IN ('sent', 'rejected')
       AND (status != 'sending' OR claimed_at <= ?)`,
  ).bind(claimToken, now.toISOString(), day, new Date(now.getTime() - CLAIM_TIMEOUT_MS).toISOString()).run();
  if (!claim.meta.changes) return;
  try {
    const result = await sendLineNotification(env, report.message, fetchImpl, report.retry_key);
    if (result !== "sent") throw new Error("Daily forecast LINE configuration unavailable");
    await env.DB.prepare(
      `UPDATE forecast_daily_reports SET status = 'sent', sent_at = ?
       WHERE report_day = ? AND claim_token = ?`,
    ).bind(new Date().toISOString(), day, claimToken).run();
    console.log(JSON.stringify({ event: "forecast_daily_report_sent", day }));
  } catch (error) {
    const status = error instanceof LineNotificationError && error.status >= 400 && error.status < 500
      ? "rejected" : "failed";
    await env.DB.prepare(
      `UPDATE forecast_daily_reports SET status = ? WHERE report_day = ? AND claim_token = ?`,
    ).bind(status, day, claimToken).run();
    console.error(JSON.stringify({ event: "forecast_daily_report_failed", day, status }));
    throw error;
  }
}
