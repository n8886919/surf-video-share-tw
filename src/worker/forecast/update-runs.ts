import { canonicalForecastSlot, type ForecastSource } from "./schedule";

/** Range uses the existing source/slot index; legacy second offsets stay immutable. */
export async function readCompletedForecastSlots(
  db: D1Database,
  source: ForecastSource,
  slots: readonly string[],
): Promise<Map<string, string>> {
  const completed = new Map<string, string>();
  if (!slots.length) return completed;
  const ordered = [...slots].sort();
  const allowed = new Set(slots);
  const end = new Date(Date.parse(ordered[ordered.length - 1]) + 60_000).toISOString();
  const rows = await db.prepare(
    `SELECT slot_at, completed_at FROM forecast_update_runs
     WHERE source = ? AND slot_at >= ? AND slot_at < ? AND completed_at IS NOT NULL
     ORDER BY slot_at`,
  ).bind(source, ordered[0], end).all<{ slot_at: string; completed_at: string }>();
  for (const row of rows.results) {
    const slot = canonicalForecastSlot(source, row.slot_at);
    if (!slot || !allowed.has(slot)) continue;
    const previous = completed.get(slot);
    if (!previous || row.completed_at < previous) completed.set(slot, row.completed_at);
  }
  return completed;
}
