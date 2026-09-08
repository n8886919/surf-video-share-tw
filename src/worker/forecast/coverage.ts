import type { ForecastSnapshotInput } from "./types";

export function hasHourlyCoverage(snapshots: ForecastSnapshotInput[], retrievedAt: string, futureHours: number): boolean {
  const start = Math.floor(Date.parse(retrievedAt) / 3_600_000) * 3_600_000 - 6 * 3_600_000;
  const hours = new Set(snapshots.filter(row => row.waveHeight !== null && row.waveDirection !== null && row.wavePeriod !== null)
    .map(row => Date.parse(row.validAt)));
  for (let index = 0; index < futureHours + 6; index++) {
    if (!hours.has(start + index * 3_600_000)) return false;
  }
  return true;
}
