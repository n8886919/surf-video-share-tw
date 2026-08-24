import { index, integer, real, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

export const users = sqliteTable(
  "users",
  {
    id: text("id").primaryKey(),
    lineSubject: text("line_subject").notNull(),
    displayId: text("display_id"),
    showIdentityDefault: integer("show_identity_default", { mode: "boolean" })
      .notNull()
      .default(false),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [uniqueIndex("users_line_subject_idx").on(table.lineSubject)],
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
  windSpeed: real("wind_speed"),
  windDirection: real("wind_direction"),
  tideHeight: real("tide_height"),
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

export const videos = sqliteTable(
  "videos",
  {
    id: text("id").primaryKey(),
    userId: text("user_id").notNull().references(() => users.id),
    spotId: text("spot_id").notNull().references(() => spots.id),
    videoProvider: text("video_provider").notNull(),
    providerVideoId: text("provider_video_id").notNull(),
    capturedAt: text("captured_at").notNull(),
    uploadedAt: text("uploaded_at"),
    durationSeconds: real("duration_seconds"),
    status: text("status").notNull(),
    showUploader: integer("show_uploader", { mode: "boolean" }).notNull(),
    conditionSnapshotId: text("condition_snapshot_id").references(
      () => conditionSnapshots.id,
    ),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [
    index("videos_spot_captured_at_idx").on(table.spotId, table.capturedAt),
    index("videos_condition_snapshot_idx").on(table.conditionSnapshotId),
    uniqueIndex("videos_provider_video_idx").on(
      table.videoProvider,
      table.providerVideoId,
    ),
  ],
);
