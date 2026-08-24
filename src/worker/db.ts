import spotCsv from "../../data/spots.csv?raw";
import type { MarineConditions } from "../../packages/domain/src";

export interface AppEnv {
  ASSETS: Fetcher;
  DB: D1Database;
  IMAGES?: {
    input(stream: ReadableStream): {
      transform(options: Record<string, unknown>): {
        output(options: { format: string; quality: number }): Promise<{ response(): Response }>;
      };
    };
  };
  APP_ENV?: string;
  ENABLE_DEV_AUTH?: string;
  VIDEO_PROVIDER?: string;
  CONDITIONS_PROVIDER?: string;
  CLOUDFLARE_ACCOUNT_ID?: string;
  CLOUDFLARE_STREAM_API_TOKEN?: string;
  LINE_CHANNEL_ID?: string;
  LINE_CHANNEL_SECRET?: string;
  LINE_CALLBACK_URL?: string;
  SESSION_SECRET?: string;
}

export interface UserRow {
  id: string;
  display_id: string | null;
  show_identity_default: number;
}

export interface SpotRow {
  id: string;
  slug: string;
  name_en: string;
  name_zh: string | null;
  region: string;
  latitude: number | null;
  longitude: number | null;
}

const schemaStatements = [
  `CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY NOT NULL,
    line_subject TEXT NOT NULL,
    display_id TEXT,
    show_identity_default INTEGER DEFAULT 0 NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  )`,
  `CREATE UNIQUE INDEX IF NOT EXISTS users_line_subject_idx ON users (line_subject)`,
  `CREATE TABLE IF NOT EXISTS auth_sessions (
    id_hash TEXT PRIMARY KEY NOT NULL,
    user_id TEXT NOT NULL REFERENCES users(id),
    expires_at TEXT NOT NULL,
    created_at TEXT NOT NULL,
    last_seen_at TEXT NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS auth_sessions_user_id_idx ON auth_sessions (user_id)`,
  `CREATE INDEX IF NOT EXISTS auth_sessions_expires_at_idx ON auth_sessions (expires_at)`,
  `CREATE TABLE IF NOT EXISTS oauth_attempts (
    state_hash TEXT PRIMARY KEY NOT NULL,
    nonce TEXT NOT NULL,
    code_verifier TEXT NOT NULL,
    expires_at TEXT NOT NULL,
    created_at TEXT NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS oauth_attempts_expires_at_idx ON oauth_attempts (expires_at)`,
  `CREATE TABLE IF NOT EXISTS spots (
    id TEXT PRIMARY KEY NOT NULL,
    slug TEXT NOT NULL,
    name_en TEXT NOT NULL,
    name_zh TEXT,
    region TEXT NOT NULL,
    latitude REAL,
    longitude REAL,
    coordinate_source TEXT,
    source_notes TEXT,
    active INTEGER DEFAULT 1 NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  )`,
  `CREATE UNIQUE INDEX IF NOT EXISTS spots_slug_idx ON spots (slug)`,
  `CREATE TABLE IF NOT EXISTS condition_snapshots (
    id TEXT PRIMARY KEY NOT NULL,
    wave_height REAL,
    wave_direction REAL,
    wave_period REAL,
    swell_height REAL,
    swell_direction REAL,
    swell_period REAL,
    secondary_swell_height REAL,
    secondary_swell_direction REAL,
    secondary_swell_period REAL,
    wind_speed REAL,
    wind_direction REAL,
    tide_height REAL,
    tide_state TEXT,
    valid_time TEXT NOT NULL,
    provider TEXT NOT NULL,
    model TEXT,
    model_run_time TEXT,
    retrieved_at TEXT NOT NULL,
    schema_version INTEGER NOT NULL,
    raw_payload TEXT,
    created_at TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS videos (
    id TEXT PRIMARY KEY NOT NULL,
    user_id TEXT NOT NULL REFERENCES users(id),
    spot_id TEXT NOT NULL REFERENCES spots(id),
    video_provider TEXT NOT NULL,
    provider_video_id TEXT NOT NULL,
    captured_at TEXT NOT NULL,
    uploaded_at TEXT,
    duration_seconds REAL,
    status TEXT NOT NULL,
    show_uploader INTEGER NOT NULL,
    condition_snapshot_id TEXT REFERENCES condition_snapshots(id),
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS videos_spot_captured_at_idx ON videos (spot_id, captured_at)`,
  `CREATE INDEX IF NOT EXISTS videos_condition_snapshot_idx ON videos (condition_snapshot_id)`,
  `CREATE UNIQUE INDEX IF NOT EXISTS videos_provider_video_idx ON videos (video_provider, provider_video_id)`,
] as const;

function parseSeedCsv(): Array<{
  slug: string;
  nameEn: string;
  nameZh: string | null;
  region: string;
  latitude: number | null;
  longitude: number | null;
  coordinateSource: string | null;
  sourceNotes: string | null;
  active: number;
}> {
  return spotCsv.trim().split("\n").slice(1).map((line) => {
    const [slug, nameEn, nameZh, region, latitude, longitude, coordinateSource, sourceNotes, active] = line.split(",");
    return {
      slug,
      nameEn,
      nameZh: nameZh || null,
      region,
      latitude: latitude ? Number(latitude) : null,
      longitude: longitude ? Number(longitude) : null,
      coordinateSource: coordinateSource || null,
      sourceNotes: sourceNotes || null,
      active: active === "true" ? 1 : 0,
    };
  });
}

export async function ensureDevelopmentDatabase(env: AppEnv): Promise<void> {
  if (env.APP_ENV !== "development") return;
  await env.DB.batch(schemaStatements.map((sql) => env.DB.prepare(sql)));
  const now = new Date().toISOString();
  const inserts = parseSeedCsv().map((spot) =>
    env.DB.prepare(
      `INSERT INTO spots
       (id, slug, name_en, name_zh, region, latitude, longitude, coordinate_source, source_notes, active, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(slug) DO UPDATE SET
         name_en = excluded.name_en,
         name_zh = excluded.name_zh,
         region = excluded.region,
         latitude = excluded.latitude,
         longitude = excluded.longitude,
         coordinate_source = excluded.coordinate_source,
         source_notes = excluded.source_notes,
         active = excluded.active,
         updated_at = excluded.updated_at`,
    ).bind(
      `spot_${spot.slug}`,
      spot.slug,
      spot.nameEn,
      spot.nameZh,
      spot.region,
      spot.latitude,
      spot.longitude,
      spot.coordinateSource,
      spot.sourceNotes,
      spot.active,
      now,
      now,
    ),
  );
  await env.DB.batch(inserts);
}

export async function getOrCreateDevUser(env: AppEnv): Promise<UserRow | null> {
  if (env.APP_ENV !== "development" || env.ENABLE_DEV_AUTH !== "true") return null;
  const now = new Date().toISOString();
  await env.DB.prepare(
    `INSERT OR IGNORE INTO users
     (id, line_subject, display_id, show_identity_default, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?)`,
  ).bind("user_dev_local", "dev-only-subject", "wave-friend", 1, now, now).run();
  return env.DB.prepare(
    `SELECT id, display_id, show_identity_default FROM users WHERE id = ?`,
  ).bind("user_dev_local").first<UserRow>();
}

export async function insertConditionSnapshot(
  db: D1Database,
  id: string,
  conditions: MarineConditions,
): Promise<void> {
  await db.prepare(
    `INSERT INTO condition_snapshots (
      id, wave_height, wave_direction, wave_period,
      swell_height, swell_direction, swell_period,
      secondary_swell_height, secondary_swell_direction, secondary_swell_period,
      wind_speed, wind_direction, tide_height, tide_state,
      valid_time, provider, model, model_run_time, retrieved_at, schema_version,
      raw_payload, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).bind(
    id,
    conditions.waveHeight,
    conditions.waveDirection,
    conditions.wavePeriod,
    conditions.swellHeight,
    conditions.swellDirection,
    conditions.swellPeriod,
    conditions.secondarySwellHeight,
    conditions.secondarySwellDirection,
    conditions.secondarySwellPeriod,
    conditions.windSpeed,
    conditions.windDirection,
    conditions.tideHeight,
    conditions.tideState,
    conditions.validTime,
    conditions.provider,
    conditions.model,
    conditions.modelRunTime,
    conditions.retrievedAt,
    conditions.schemaVersion,
    null,
    new Date().toISOString(),
  ).run();
}
