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
  PUBLIC_SITE_ORIGIN?: string;
  UPLOAD_RATE_LIMITER?: RateLimit;
  PLAYBACK_RATE_LIMITER?: RateLimit;
  DOWNLOAD_RATE_LIMITER?: RateLimit;
  PUBLIC_WRITE_RATE_LIMITER?: RateLimit;
  LINE_CHANNEL_ID?: string;
  LINE_CHANNEL_SECRET?: string;
  LINE_CALLBACK_URL?: string;
  SESSION_SECRET?: string;
  ADMIN_USER_ID?: string;
  CWA_QUERY_STRING_REDACTION_VERIFIED?: string;
  FORECAST_INGESTION_SECRET?: string;
  AI?: {
    run(model: string, inputs: Record<string, unknown>): Promise<unknown>;
  };
  LINE_MESSAGING_CHANNEL_ACCESS_TOKEN?: string;
  OPS_LINE_USER_ID?: string;
}

export interface UserRow {
  id: string;
  line_display_name: string | null;
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
    line_display_name TEXT,
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
      wind_wave_height REAL,
      wind_wave_direction REAL,
      wind_wave_period REAL,
      wind_speed REAL,
      wind_direction REAL,
      wind_gust REAL,
      tide_height REAL,
      tide_slope REAL,
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
  `CREATE TABLE IF NOT EXISTS forecast_snapshots (
    id TEXT PRIMARY KEY NOT NULL,
    spot_id TEXT NOT NULL REFERENCES spots(id),
    provider TEXT NOT NULL,
    model TEXT NOT NULL,
    issued_at TEXT NOT NULL,
    model_run_at TEXT,
    valid_at TEXT NOT NULL,
    lead_hours REAL,
    grid_latitude REAL,
    grid_longitude REAL,
    wave_height REAL,
    wave_direction REAL,
    wave_period REAL,
    swell_height REAL,
    swell_direction REAL,
    swell_period REAL,
    secondary_swell_height REAL,
    secondary_swell_direction REAL,
    secondary_swell_period REAL,
    wind_wave_height REAL,
    wind_wave_direction REAL,
    wind_wave_period REAL,
    tide_height REAL,
    tide_slope REAL,
    tide_state TEXT,
    wind_speed REAL,
    wind_direction REAL,
    wind_gust REAL,
    retrieved_at TEXT NOT NULL,
    schema_version INTEGER NOT NULL,
    raw_payload TEXT,
    created_at TEXT NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS forecast_spot_valid_at_idx ON forecast_snapshots (spot_id, valid_at)`,
  `CREATE UNIQUE INDEX IF NOT EXISTS forecast_source_run_idx ON forecast_snapshots (spot_id, provider, model, issued_at, valid_at)`,
  `CREATE TABLE IF NOT EXISTS videos (
    id TEXT PRIMARY KEY NOT NULL,
    user_id TEXT NOT NULL REFERENCES users(id),
    spot_id TEXT REFERENCES spots(id),
    video_provider TEXT NOT NULL,
    provider_video_id TEXT NOT NULL,
    captured_at TEXT,
    uploaded_at TEXT,
    duration_seconds REAL,
    status TEXT NOT NULL,
    show_uploader INTEGER NOT NULL,
    metadata_status TEXT DEFAULT 'pending' NOT NULL,
    metadata_expires_at TEXT,
    public_at TEXT,
    is_favorite INTEGER DEFAULT 0 NOT NULL,
    uploader_note TEXT,
    fun_reaction TEXT,
    terms_version TEXT,
    moderation_status TEXT DEFAULT 'visible' NOT NULL,
    delisted_at TEXT,
    delisted_reason TEXT,
    condition_snapshot_id TEXT REFERENCES condition_snapshots(id),
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS videos_spot_captured_at_idx ON videos (spot_id, captured_at)`,
  `CREATE INDEX IF NOT EXISTS videos_condition_snapshot_idx ON videos (condition_snapshot_id)`,
  `CREATE INDEX IF NOT EXISTS videos_public_spot_captured_at_idx ON videos (public_at, spot_id, captured_at)`,
  `CREATE INDEX IF NOT EXISTS videos_metadata_expires_at_idx ON videos (metadata_expires_at)`,
  `CREATE INDEX IF NOT EXISTS videos_public_lookup_idx ON videos (moderation_status, public_at, spot_id, captured_at)`,
  `CREATE UNIQUE INDEX IF NOT EXISTS videos_provider_video_idx ON videos (video_provider, provider_video_id)`,
  `CREATE TABLE IF NOT EXISTS video_playback_events (
    id TEXT PRIMARY KEY NOT NULL,
    video_id TEXT NOT NULL REFERENCES videos(id) ON DELETE CASCADE,
    started_at TEXT NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS video_playback_events_video_started_idx ON video_playback_events (video_id, started_at)`,
  `CREATE INDEX IF NOT EXISTS video_playback_events_started_at_idx ON video_playback_events (started_at)`,
  `CREATE TABLE IF NOT EXISTS share_playback_budgets (
    id TEXT PRIMARY KEY NOT NULL,
    exporter_user_id TEXT NOT NULL REFERENCES users(id),
    period TEXT NOT NULL,
    used INTEGER DEFAULT 0 NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  )`,
  `CREATE UNIQUE INDEX IF NOT EXISTS share_playback_budgets_exporter_period_idx
    ON share_playback_budgets (exporter_user_id, period)`,
  `CREATE TABLE IF NOT EXISTS video_reports (
    id TEXT PRIMARY KEY NOT NULL,
    video_id TEXT NOT NULL REFERENCES videos(id),
    reason TEXT NOT NULL,
    status TEXT DEFAULT 'open' NOT NULL,
    created_at TEXT NOT NULL,
    resolved_at TEXT,
    resolved_by_user_id TEXT REFERENCES users(id)
  )`,
  `CREATE INDEX IF NOT EXISTS video_reports_status_created_at_idx ON video_reports (status, created_at)`,
  `CREATE INDEX IF NOT EXISTS video_reports_video_id_idx ON video_reports (video_id)`,
  `CREATE TABLE IF NOT EXISTS problem_reports (
    id TEXT PRIMARY KEY NOT NULL,
    message TEXT NOT NULL,
    view TEXT NOT NULL,
    status TEXT DEFAULT 'open' NOT NULL,
    created_at TEXT NOT NULL,
    resolved_at TEXT,
    resolved_by_user_id TEXT REFERENCES users(id)
  )`,
  `CREATE INDEX IF NOT EXISTS problem_reports_status_created_at_idx ON problem_reports (status, created_at)`,
  `CREATE TABLE IF NOT EXISTS ops_events (
    id TEXT PRIMARY KEY NOT NULL,
    event_code TEXT NOT NULL,
    severity TEXT NOT NULL,
    source TEXT NOT NULL,
    fingerprint TEXT NOT NULL,
    request_id TEXT,
    route TEXT,
    error_name TEXT,
    summary TEXT,
    occurred_at TEXT NOT NULL,
    created_at TEXT NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS ops_events_occurred_at_idx ON ops_events (occurred_at)`,
  `CREATE INDEX IF NOT EXISTS ops_events_severity_occurred_at_idx ON ops_events (severity, occurred_at)`,
  `CREATE INDEX IF NOT EXISTS ops_events_fingerprint_occurred_at_idx ON ops_events (fingerprint, occurred_at)`,
  `CREATE TABLE IF NOT EXISTS ops_incidents (
    fingerprint TEXT PRIMARY KEY NOT NULL,
    status TEXT NOT NULL,
    severity TEXT NOT NULL,
    title TEXT NOT NULL,
    first_seen_at TEXT NOT NULL,
    last_seen_at TEXT NOT NULL,
    occurrences INTEGER DEFAULT 1 NOT NULL,
    notified_at TEXT,
    recovered_at TEXT,
    recovery_notified_at TEXT,
    updated_at TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS ops_analysis_runs (
    id TEXT PRIMARY KEY NOT NULL,
    window_start TEXT NOT NULL,
    window_end TEXT NOT NULL,
    status TEXT NOT NULL,
    severity TEXT NOT NULL,
    event_count INTEGER NOT NULL,
    summary_zh TEXT NOT NULL,
    patterns_json TEXT NOT NULL,
    recommended_checks_json TEXT NOT NULL,
    notified_at TEXT,
    created_at TEXT NOT NULL
  )`,
  `CREATE UNIQUE INDEX IF NOT EXISTS ops_analysis_runs_window_idx
    ON ops_analysis_runs (window_start, window_end)`,
  `CREATE INDEX IF NOT EXISTS ops_analysis_runs_created_at_idx ON ops_analysis_runs (created_at)`,
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
  return spotCsv.trim().split(/\r?\n/).slice(1).map((line) => {
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
     (id, line_subject, line_display_name, display_id, show_identity_default, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  ).bind("user_dev_local", "dev-only-subject", "Wave Friend", "wave-friend", 1, now, now).run();
  return env.DB.prepare(
    `SELECT id, line_display_name, display_id, show_identity_default FROM users WHERE id = ?`,
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
      wind_wave_height, wind_wave_direction, wind_wave_period,
      wind_speed, wind_direction, wind_gust, tide_height, tide_slope, tide_state,
      valid_time, provider, model, model_run_time, retrieved_at, schema_version,
      raw_payload, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
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
    conditions.windWaveHeight,
    conditions.windWaveDirection,
    conditions.windWavePeriod,
    conditions.windSpeed,
    conditions.windDirection,
    conditions.windGust,
    conditions.tideHeight,
    conditions.tideSlope,
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
