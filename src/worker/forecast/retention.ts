const DAY_MS = 86_400_000;
const WINDOW_MS = 4 * 3_600_000;
const PAGE_SIZE = 4000;
// One JSON-array binding avoids D1's 100-parameter limit without extra queries.
const DELETE_LIMIT = 2000;
const DAILY_WRITE_BUDGET = 25_000;
const WRITE_RESERVE = 1000;
const MAX_WRITES_PER_ROW = 10;

export interface RetentionVideo { spot_id: string | null; captured_at: string | null; created_at: string }
export interface RetentionRow { rowid: number; id: string; spot_id: string; valid_at: string }

export function createForecastProtection(videos: RetentionVideo[], now: Date) {
  const cutoff = now.getTime() - 8 * DAY_MS;
  const invalidCreation = videos.some(video => !Number.isFinite(Date.parse(video.created_at)));
  const capturesBySpot = new Map<string, number[] | null>();
  for (const video of videos) {
    if (!video.spot_id || capturesBySpot.get(video.spot_id) === null) continue;
    const capture = video.captured_at ? Date.parse(video.captured_at) : NaN;
    if (!Number.isFinite(capture)) capturesBySpot.set(video.spot_id, null);
    else {
      const captures = capturesBySpot.get(video.spot_id) ?? [];
      captures.push(capture);
      capturesBySpot.set(video.spot_id, captures);
    }
  }
  // Spot/capture time are immutable after ticket creation. Keep their actual
  // matching neighbourhoods, not the retired seven-day capture-edit window.
  return (row: RetentionRow): boolean => {
    const valid = Date.parse(row.valid_at);
    if (invalidCreation || !Number.isFinite(valid) || valid >= cutoff) return true;
    const captures = capturesBySpot.get(row.spot_id);
    return captures === null || (captures?.some(capture => Math.abs(valid - capture) <= WINDOW_MS) ?? false);
  };
}

export function protectedForecast(row: RetentionRow, videos: RetentionVideo[], now: Date): boolean {
  return createForecastProtection(videos, now)(row);
}

// Recheck live rows atomically at deletion time: a concurrent upload/edit wins protection.
const LIVE_PROTECTION = `NOT EXISTS (SELECT 1 FROM videos WHERE julianday(created_at) IS NULL)
  AND NOT EXISTS (SELECT 1 FROM videos v WHERE v.spot_id = forecast_snapshots.spot_id
    AND (v.captured_at IS NULL OR julianday(v.captured_at) IS NULL OR
      ABS(julianday(forecast_snapshots.valid_at) - julianday(v.captured_at)) <= 4.0/24 + 0.00000001))`;

export const FORECAST_HISTORY_DELETE_SQL = `DELETE FROM forecast_snapshots
  WHERE id IN (SELECT value FROM json_each(?))
    AND julianday(valid_at) < julianday(?) - 8 AND ${LIVE_PROTECTION}`;

/** Small rowid pages avoid a costly new index over all existing forecast history. */
export async function cleanupForecastHistory(db: D1Database, now: Date, dryRun = false) {
  const state = await db.prepare("SELECT cursor, budget_day, writes FROM forecast_retention_state WHERE id = 'history'")
    .first<{ cursor: number; budget_day: string; writes: number }>();
  const day = now.toISOString().slice(0, 10);
  const spent = state?.budget_day === day ? state.writes : 0;
  // Reserve a worst-case indexed write allowance before sizing this batch.
  const deleteLimit = Math.min(DELETE_LIMIT,
    Math.floor((DAILY_WRITE_BUDGET - WRITE_RESERVE - spent - 4) / MAX_WRITES_PER_ROW));
  if (!dryRun && deleteLimit < 1) return { status: "budget_paused", deleted: 0 };
  const token = crypto.randomUUID();
  if (!dryRun) {
    const claim = await db.prepare(`INSERT INTO forecast_retention_state
      (id, cursor, budget_day, writes, lease_token, lease_until, last_hour)
      VALUES ('history', 0, ?, 0, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET lease_token = excluded.lease_token, lease_until = excluded.lease_until,
        last_hour = excluded.last_hour, budget_day = excluded.budget_day,
        writes = CASE WHEN forecast_retention_state.budget_day = excluded.budget_day THEN forecast_retention_state.writes ELSE 0 END
      WHERE forecast_retention_state.lease_until <= ? AND forecast_retention_state.last_hour <> excluded.last_hour`)
      .bind(day, token, new Date(now.getTime() + 30 * 60_000).toISOString(), now.toISOString().slice(0, 13), now.toISOString()).run();
    if (!claim.meta.changes) return { status: "already_claimed", deleted: 0 };
  }
  const [page, videos] = await Promise.all([
    db.prepare("SELECT rowid, id, spot_id, valid_at FROM forecast_snapshots WHERE rowid > ? ORDER BY rowid LIMIT ?")
      .bind(state?.cursor ?? 0, PAGE_SIZE).all<RetentionRow>(),
    db.prepare("SELECT spot_id, captured_at, created_at FROM videos").all<RetentionVideo>(),
  ]);
  const candidates: RetentionRow[] = [];
  const isProtected = createForecastProtection(videos.results, now);
  let cursor = 0;
  for (const row of page.results) {
    cursor = row.rowid;
    if (!isProtected(row)) candidates.push(row);
    if (candidates.length === (dryRun ? DELETE_LIMIT : deleteLimit)) break;
  }
  let deleted = 0; let rowsWritten = 0;
  if (!dryRun && candidates.length) {
    const result = await db.prepare(FORECAST_HISTORY_DELETE_SQL)
      .bind(JSON.stringify(candidates.map(row => row.id)), now.toISOString()).run();
    deleted = result.meta.changes;
    // Local SQLite test doubles have no billing metrics; conservative indexed-write estimate.
    rowsWritten = result.meta.rows_written ?? deleted * MAX_WRITES_PER_ROW;
  }
  if (!dryRun) await db.prepare(`UPDATE forecast_retention_state SET cursor = ?, writes = writes + ?, lease_until = ?
    WHERE id = 'history' AND lease_token = ?`).bind(cursor, rowsWritten + 4, now.toISOString(), token).run();
  const summary = { status: dryRun ? "dry_run" : "complete", scanned: page.results.length,
    eligible: candidates.length, deleted, rowsWritten, cursor,
    capped: candidates.length === (dryRun ? DELETE_LIMIT : deleteLimit) };
  console.log(JSON.stringify({ event: "forecast_retention", ...summary }));
  return summary;
}
