import { index, integer, real, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

export const users = sqliteTable(
  "users",
  {
    id: text("id").primaryKey(),
    lineSubject: text("line_subject").notNull(),
    lineDisplayName: text("line_display_name"),
    displayId: text("display_id"),
    showIdentityDefault: integer("show_identity_default", { mode: "boolean" })
      .notNull()
      .default(false),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [uniqueIndex("users_line_subject_idx").on(table.lineSubject)],
);

export const authSessions = sqliteTable(
  "auth_sessions",
  {
    idHash: text("id_hash").primaryKey(),
    userId: text("user_id").notNull().references(() => users.id),
    expiresAt: text("expires_at").notNull(),
    createdAt: text("created_at").notNull(),
    lastSeenAt: text("last_seen_at").notNull(),
  },
  (table) => [
    index("auth_sessions_user_id_idx").on(table.userId),
    index("auth_sessions_expires_at_idx").on(table.expiresAt),
  ],
);

export const oauthAttempts = sqliteTable(
  "oauth_attempts",
  {
    stateHash: text("state_hash").primaryKey(),
    nonce: text("nonce").notNull(),
    codeVerifier: text("code_verifier").notNull(),
    expiresAt: text("expires_at").notNull(),
    createdAt: text("created_at").notNull(),
  },
  (table) => [index("oauth_attempts_expires_at_idx").on(table.expiresAt)],
);

export const spots = sqliteTable(
  "spots",
  {
    id: text("id").primaryKey(),
    slug: text("slug").notNull(),
    nameEn: text("name_en").notNull(),
    nameZh: text("name_zh"),
    region: text("region").notNull(),
    latitude: real("latitude"),
    longitude: real("longitude"),
    coordinateSource: text("coordinate_source"),
    sourceNotes: text("source_notes"),
    active: integer("active", { mode: "boolean" }).notNull().default(true),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [uniqueIndex("spots_slug_idx").on(table.slug)],
);

export const conditionSnapshots = sqliteTable("condition_snapshots", {
  id: text("id").primaryKey(),
  waveHeight: real("wave_height"),
  waveDirection: real("wave_direction"),
  wavePeriod: real("wave_period"),
  swellHeight: real("swell_height"),
  swellDirection: real("swell_direction"),
  swellPeriod: real("swell_period"),
  secondarySwellHeight: real("secondary_swell_height"),
  secondarySwellDirection: real("secondary_swell_direction"),
  secondarySwellPeriod: real("secondary_swell_period"),
  windWaveHeight: real("wind_wave_height"),
  windWaveDirection: real("wind_wave_direction"),
  windWavePeriod: real("wind_wave_period"),
  windSpeed: real("wind_speed"),
  windDirection: real("wind_direction"),
  windGust: real("wind_gust"),
  tideHeight: real("tide_height"),
  tideSlope: real("tide_slope"),
  tideState: text("tide_state"),
  validTime: text("valid_time").notNull(),
  provider: text("provider").notNull(),
  model: text("model"),
  modelRunTime: text("model_run_time"),
  retrievedAt: text("retrieved_at").notNull(),
  schemaVersion: integer("schema_version").notNull(),
  rawPayload: text("raw_payload"),
  createdAt: text("created_at").notNull(),
});

export const forecastSnapshots = sqliteTable(
  "forecast_snapshots",
  {
    id: text("id").primaryKey(),
    spotId: text("spot_id").notNull().references(() => spots.id),
    provider: text("provider").notNull(),
    model: text("model").notNull(),
    issuedAt: text("issued_at").notNull(),
    modelRunAt: text("model_run_at"),
    validAt: text("valid_at").notNull(),
    leadHours: real("lead_hours"),
    gridLatitude: real("grid_latitude"),
    gridLongitude: real("grid_longitude"),
    waveHeight: real("wave_height"),
    waveDirection: real("wave_direction"),
    wavePeriod: real("wave_period"),
    swellHeight: real("swell_height"),
    swellDirection: real("swell_direction"),
    swellPeriod: real("swell_period"),
    secondarySwellHeight: real("secondary_swell_height"),
    secondarySwellDirection: real("secondary_swell_direction"),
    secondarySwellPeriod: real("secondary_swell_period"),
    windWaveHeight: real("wind_wave_height"),
    windWaveDirection: real("wind_wave_direction"),
    windWavePeriod: real("wind_wave_period"),
    tideHeight: real("tide_height"),
    tideSlope: real("tide_slope"),
    tideState: text("tide_state"),
    windSpeed: real("wind_speed"),
    windDirection: real("wind_direction"),
    windGust: real("wind_gust"),
    retrievedAt: text("retrieved_at").notNull(),
    schemaVersion: integer("schema_version").notNull(),
    rawPayload: text("raw_payload"),
    createdAt: text("created_at").notNull(),
  },
  (table) => [
    index("forecast_spot_valid_at_idx").on(table.spotId, table.validAt),
    uniqueIndex("forecast_source_run_idx").on(
      table.spotId,
      table.provider,
      table.model,
      table.issuedAt,
      table.validAt,
    ),
  ],
);

export const videos = sqliteTable(
  "videos",
  {
    id: text("id").primaryKey(),
    userId: text("user_id").notNull().references(() => users.id),
    spotId: text("spot_id").references(() => spots.id),
    videoProvider: text("video_provider").notNull(),
    providerVideoId: text("provider_video_id").notNull(),
    capturedAt: text("captured_at"),
    uploadedAt: text("uploaded_at"),
    durationSeconds: real("duration_seconds"),
    status: text("status").notNull(),
    showUploader: integer("show_uploader", { mode: "boolean" }).notNull(),
    metadataStatus: text("metadata_status").notNull().default("pending"),
    metadataExpiresAt: text("metadata_expires_at"),
    publicAt: text("public_at"),
    isFavorite: integer("is_favorite", { mode: "boolean" }).notNull().default(false),
    uploaderNote: text("uploader_note"),
    funReaction: text("fun_reaction"),
    termsVersion: text("terms_version"),
    moderationStatus: text("moderation_status").notNull().default("visible"),
    delistedAt: text("delisted_at"),
    delistedReason: text("delisted_reason"),
    conditionSnapshotId: text("condition_snapshot_id").references(
      () => conditionSnapshots.id,
    ),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [
    index("videos_spot_captured_at_idx").on(table.spotId, table.capturedAt),
    index("videos_condition_snapshot_idx").on(table.conditionSnapshotId),
    index("videos_public_spot_captured_at_idx").on(table.publicAt, table.spotId, table.capturedAt),
    index("videos_metadata_expires_at_idx").on(table.metadataExpiresAt),
    index("videos_public_lookup_idx").on(
      table.moderationStatus,
      table.publicAt,
      table.spotId,
      table.capturedAt,
    ),
    uniqueIndex("videos_provider_video_idx").on(
      table.videoProvider,
      table.providerVideoId,
    ),
  ],
);

export const videoPlaybackEvents = sqliteTable(
  "video_playback_events",
  {
    id: text("id").primaryKey(),
    videoId: text("video_id").notNull().references(() => videos.id, { onDelete: "cascade" }),
    startedAt: text("started_at").notNull(),
  },
  (table) => [
    index("video_playback_events_video_started_idx").on(table.videoId, table.startedAt),
    index("video_playback_events_started_at_idx").on(table.startedAt),
  ],
);

export const sharePlaybackBudgets = sqliteTable(
  "share_playback_budgets",
  {
    id: text("id").primaryKey(),
    exporterUserId: text("exporter_user_id").notNull().references(() => users.id),
    period: text("period").notNull(),
    used: integer("used").notNull().default(0),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [
    uniqueIndex("share_playback_budgets_exporter_period_idx").on(
      table.exporterUserId,
      table.period,
    ),
  ],
);

export const videoReports = sqliteTable(
  "video_reports",
  {
    id: text("id").primaryKey(),
    videoId: text("video_id").notNull().references(() => videos.id),
    reason: text("reason").notNull(),
    status: text("status").notNull().default("open"),
    createdAt: text("created_at").notNull(),
    resolvedAt: text("resolved_at"),
    resolvedByUserId: text("resolved_by_user_id").references(() => users.id),
  },
  (table) => [
    index("video_reports_status_created_at_idx").on(table.status, table.createdAt),
    index("video_reports_video_id_idx").on(table.videoId),
  ],
);

export const problemReports = sqliteTable(
  "problem_reports",
  {
    id: text("id").primaryKey(),
    message: text("message").notNull(),
    view: text("view").notNull(),
    status: text("status").notNull().default("open"),
    createdAt: text("created_at").notNull(),
    resolvedAt: text("resolved_at"),
    resolvedByUserId: text("resolved_by_user_id").references(() => users.id),
  },
  (table) => [
    index("problem_reports_status_created_at_idx").on(table.status, table.createdAt),
  ],
);

export const opsEvents = sqliteTable(
  "ops_events",
  {
    id: text("id").primaryKey(),
    eventCode: text("event_code").notNull(),
    severity: text("severity").notNull(),
    source: text("source").notNull(),
    fingerprint: text("fingerprint").notNull(),
    requestId: text("request_id"),
    route: text("route"),
    errorName: text("error_name"),
    summary: text("summary"),
    occurredAt: text("occurred_at").notNull(),
    createdAt: text("created_at").notNull(),
  },
  (table) => [
    index("ops_events_occurred_at_idx").on(table.occurredAt),
    index("ops_events_severity_occurred_at_idx").on(table.severity, table.occurredAt),
    index("ops_events_fingerprint_occurred_at_idx").on(table.fingerprint, table.occurredAt),
  ],
);

export const opsIncidents = sqliteTable("ops_incidents", {
  fingerprint: text("fingerprint").primaryKey(),
  status: text("status").notNull(),
  severity: text("severity").notNull(),
  title: text("title").notNull(),
  firstSeenAt: text("first_seen_at").notNull(),
  lastSeenAt: text("last_seen_at").notNull(),
  occurrences: integer("occurrences").notNull().default(1),
  notifiedAt: text("notified_at"),
  recoveredAt: text("recovered_at"),
  recoveryNotifiedAt: text("recovery_notified_at"),
  updatedAt: text("updated_at").notNull(),
});

export const opsAnalysisRuns = sqliteTable(
  "ops_analysis_runs",
  {
    id: text("id").primaryKey(),
    windowStart: text("window_start").notNull(),
    windowEnd: text("window_end").notNull(),
    status: text("status").notNull(),
    severity: text("severity").notNull(),
    eventCount: integer("event_count").notNull(),
    summaryZh: text("summary_zh").notNull(),
    patternsJson: text("patterns_json").notNull(),
    recommendedChecksJson: text("recommended_checks_json").notNull(),
    notifiedAt: text("notified_at"),
    createdAt: text("created_at").notNull(),
  },
  (table) => [
    uniqueIndex("ops_analysis_runs_window_idx").on(table.windowStart, table.windowEnd),
    index("ops_analysis_runs_created_at_idx").on(table.createdAt),
  ],
);
