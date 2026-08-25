import type { ForecastSnapshotInput, ForecastSpot, ForecastWriteResult } from "./types";

const INSERT_BATCH_SIZE = 50;

export async function listActiveForecastSpots(db: D1Database): Promise<ForecastSpot[]> {
  const result = await db.prepare(
    `SELECT id, slug, latitude, longitude
     FROM spots
     WHERE active = 1 AND latitude IS NOT NULL AND longitude IS NOT NULL
     ORDER BY slug`,
  ).all<{ id: string; slug: string; latitude: number; longitude: number }>();
  return result.results.map((spot) => ({
    id: spot.id,
    slug: spot.slug,
    latitude: spot.latitude,
    longitude: spot.longitude,
  }));
}
export async function stableForecastId(parts: string[]): Promise<string> {
  const bytes = new TextEncoder().encode(parts.join("\u001f"));
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  const suffix = Array.from(new Uint8Array(digest).slice(0, 16), (byte) =>
    byte.toString(16).padStart(2, "0")
  ).join("");
  return `forecast_${suffix}`;
}

export async function insertForecastSnapshots(
  db: D1Database,
  snapshots: ForecastSnapshotInput[],
): Promise<ForecastWriteResult> {
  let inserted = 0;
  const createdAt = new Date().toISOString();

  for (let offset = 0; offset < snapshots.length; offset += INSERT_BATCH_SIZE) {
    const chunk = snapshots.slice(offset, offset + INSERT_BATCH_SIZE);
    const statements = chunk.map((snapshot) => db.prepare(
      `INSERT OR IGNORE INTO forecast_snapshots (
        id, spot_id, provider, model, issued_at, model_run_at, valid_at, lead_hours,
        grid_latitude, grid_longitude,
        wave_height, wave_direction, wave_period,
        swell_height, swell_direction, swell_period,
        secondary_swell_height, secondary_swell_direction, secondary_swell_period,
        wind_wave_height, wind_wave_direction, wind_wave_period,
        tide_height, tide_slope, tide_state,
        wind_speed, wind_direction, wind_gust,
        retrieved_at, schema_version, raw_payload, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).bind(
      snapshot.id,
      snapshot.spotId,
      snapshot.provider,
      snapshot.model,
      snapshot.issuedAt,
      snapshot.modelRunAt,
      snapshot.validAt,
      snapshot.leadHours,
      snapshot.gridLatitude,
      snapshot.gridLongitude,
      snapshot.waveHeight,
      snapshot.waveDirection,
      snapshot.wavePeriod,
      snapshot.swellHeight,
      snapshot.swellDirection,
      snapshot.swellPeriod,
      snapshot.secondarySwellHeight,
      snapshot.secondarySwellDirection,
      snapshot.secondarySwellPeriod,
      snapshot.windWaveHeight,
      snapshot.windWaveDirection,
      snapshot.windWavePeriod,
      snapshot.tideHeight,
      snapshot.tideSlope,
      snapshot.tideState,
      snapshot.windSpeed,
      snapshot.windDirection,
      snapshot.windGust,
      snapshot.retrievedAt,
      snapshot.schemaVersion,
      snapshot.rawPayload,
      createdAt,
    ));
    const results = await db.batch(statements);
    inserted += results.reduce((sum, result) => sum + (result.meta.changes ?? 0), 0);
  }

  return {
    attempted: snapshots.length,
    inserted,
    duplicates: snapshots.length - inserted,
  };
}
