const DAY_MS = 86_400_000;
const WINDOW_MS = 4 * 3_600_000;
const PAGE_SIZE = 2000;
// D1 permits 100 bound parameters: leave one for the cutoff timestamp.
const DELETE_LIMIT = 99;
const DAILY_WRITE_BUDGET = 15_000;

export interface RetentionVideo { spot_id: string | null; captured_at: string | null; created_at: string }
export interface RetentionRow { rowid: number; id: string; spot_id: string; valid_at: string }

export function protectedForecast(row: RetentionRow, videos: RetentionVideo[], now: Date): boolean {
  const valid = Date.parse(row.valid_at);
  if (!Number.isFinite(valid) || valid >= now.getTime() - 8 * DAY_MS) return true;
  return videos.some(video => {
    // Capture edits remain relative to creation time, even on old complete videos.
    // Keep the whole allowed correction window at this spot, not just today's value.
    const created = Date.parse(video.created_at);
    if (!Number.isFinite(created)) return true;
    if (video.spot_id !== row.spot_id) return false;
    if (valid >= created - 7 * DAY_MS - WINDOW_MS && valid <= created + WINDOW_MS) return true;
    if (!video.captured_at) return true;
    const capture = Date.parse(video.captured_at);
    return !Number.isFinite(capture) || Math.abs(valid - capture) <= WINDOW_MS;
  });
}

// Recheck live rows atomically at deletion time: a concurrent upload/edit wins protection.
const LIVE_PROTECTION = `NOT EXISTS (SELECT 1 FROM videos v WHERE
  julianday(v.created_at) IS NULL OR
  (v.spot_id = forecast_snapshots.spot_id AND (julianday(forecast_snapshots.valid_at)
    BETWEEN julianday(v.created_at) - 7 - 4.0/24 AND julianday(v.created_at) + 4.0/24 OR
    v.captured_at IS NULL OR julianday(v.captured_at) IS NULL OR
    ABS(julianday(forecast_snapshots.valid_at) - julianday(v.captured_at)) <= 4.0/24 + 0.00000001)))`;

/** Small rowid pages avoid a costly new index over all existing forecast history. */
export async function cleanupForecastHistory(db: D1Database, now: Date, dryRun = false) {
  const state = await db.prepare("SELECT cursor, budget_day, writes FROM forecast_retention_state WHERE id = 'history'")
    .first<{ cursor: number; budget_day: string; writes: number }>();
  const day = now.toISOString().slice(0, 10);
  const spent = state?.budget_day === day ? state.writes : 0;
  if (!dryRun && spent >= DAILY_WRITE_BUDGET - 1000) return { status: "budget_paused", deleted: 0 };
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
  let cursor = 0;
  for (const row of page.results) {
    cursor = row.rowid;
    if (!protectedForecast(row, videos.results, now)) candidates.push(row);
    if (candidates.length === DELETE_LIMIT) break;
  }
  let deleted = 0; let rowsWritten = 0;
  if (!dryRun && candidates.length) {
    const result = await db.prepare(`DELETE FROM forecast_snapshots
      WHERE id IN (${candidates.map(() => "?").join(",")})
        AND julianday(valid_at) < julianday(?) - 8 AND ${LIVE_PROTECTION}`)
      .bind(...candidates.map(row => row.id), now.toISOString()).run();
    deleted = result.meta.changes;
    // Local SQLite test doubles have no billing metrics; conservative indexed-write estimate.
    rowsWritten = result.meta.rows_written ?? deleted * 10;
  }
  if (!dryRun) await db.prepare(`UPDATE forecast_retention_state SET cursor = ?, writes = writes + ?, lease_until = ?
    WHERE id = 'history' AND lease_token = ?`).bind(cursor, rowsWritten + 4, now.toISOString(), token).run();
  const summary = { status: dryRun ? "dry_run" : "complete", scanned: page.results.length,
    eligible: candidates.length, deleted, rowsWritten, cursor, capped: candidates.length === DELETE_LIMIT };
  console.log(JSON.stringify({ event: "forecast_retention", ...summary }));
  return summary;
}
