-- One-time production bootstrap for Cloudflare D1 Console.
-- Historical one-time bootstrap through drizzle/0002. After using it, apply
-- drizzle/0003 and later with Wrangler; do not treat this file as the latest schema.

CREATE TABLE IF NOT EXISTS `d1_migrations` (
  `id` INTEGER PRIMARY KEY AUTOINCREMENT,
  `name` TEXT UNIQUE,
  `applied_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL
);

CREATE TABLE IF NOT EXISTS `condition_snapshots` (
  `id` text PRIMARY KEY NOT NULL,
  `wave_height` real,
  `wave_direction` real,
  `wave_period` real,
  `swell_height` real,
  `swell_direction` real,
  `swell_period` real,
  `secondary_swell_height` real,
  `secondary_swell_direction` real,
  `secondary_swell_period` real,
  `wind_speed` real,
  `wind_direction` real,
  `tide_height` real,
  `tide_state` text,
  `valid_time` text NOT NULL,
  `provider` text NOT NULL,
  `model` text,
  `model_run_time` text,
  `retrieved_at` text NOT NULL,
  `schema_version` integer NOT NULL,
  `raw_payload` text,
  `created_at` text NOT NULL
);

CREATE TABLE IF NOT EXISTS `spots` (
  `id` text PRIMARY KEY NOT NULL,
  `slug` text NOT NULL,
  `name_en` text NOT NULL,
  `name_zh` text,
  `region` text NOT NULL,
  `latitude` real,
  `longitude` real,
  `coordinate_source` text,
  `source_notes` text,
  `active` integer DEFAULT true NOT NULL,
  `created_at` text NOT NULL,
  `updated_at` text NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS `spots_slug_idx` ON `spots` (`slug`);

CREATE TABLE IF NOT EXISTS `users` (
  `id` text PRIMARY KEY NOT NULL,
  `line_subject` text NOT NULL,
  `display_id` text,
  `show_identity_default` integer DEFAULT false NOT NULL,
  `created_at` text NOT NULL,
  `updated_at` text NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS `users_line_subject_idx` ON `users` (`line_subject`);

CREATE TABLE IF NOT EXISTS `videos` (
  `id` text PRIMARY KEY NOT NULL,
  `user_id` text NOT NULL,
  `spot_id` text NOT NULL,
  `video_provider` text NOT NULL,
  `provider_video_id` text NOT NULL,
  `captured_at` text NOT NULL,
  `uploaded_at` text,
  `duration_seconds` real,
  `status` text NOT NULL,
  `show_uploader` integer NOT NULL,
  `condition_snapshot_id` text,
  `created_at` text NOT NULL,
  `updated_at` text NOT NULL,
  FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON UPDATE no action ON DELETE no action,
  FOREIGN KEY (`spot_id`) REFERENCES `spots` (`id`) ON UPDATE no action ON DELETE no action,
  FOREIGN KEY (`condition_snapshot_id`) REFERENCES `condition_snapshots` (`id`) ON UPDATE no action ON DELETE no action
);

CREATE INDEX IF NOT EXISTS `videos_spot_captured_at_idx` ON `videos` (`spot_id`, `captured_at`);
CREATE INDEX IF NOT EXISTS `videos_condition_snapshot_idx` ON `videos` (`condition_snapshot_id`);
CREATE UNIQUE INDEX IF NOT EXISTS `videos_provider_video_idx` ON `videos` (`video_provider`, `provider_video_id`);

INSERT OR IGNORE INTO `d1_migrations` (`name`) VALUES ('0000_silky_sandman.sql');

UPDATE `spots`
SET `active` = 0, `updated_at` = CURRENT_TIMESTAMP;

INSERT INTO `spots` (
  `id`, `slug`, `name_en`, `name_zh`, `region`, `latitude`, `longitude`,
  `coordinate_source`, `source_notes`, `active`, `created_at`, `updated_at`
) VALUES (
  'spot_wushi-harbor-north',
  'wushi-harbor-north',
  'Wushi Harbor',
  '烏石港',
  'Northeast',
  24.8731036,
  121.8411446,
  'https://maps.app.goo.gl/4SENnqZuYGGe8Gco7',
  'Google Maps listing 烏石港北堤衝浪點; product display name 烏石港',
  1,
  CURRENT_TIMESTAMP,
  CURRENT_TIMESTAMP
)
ON CONFLICT (`slug`) DO UPDATE SET
  `name_en` = excluded.`name_en`,
  `name_zh` = excluded.`name_zh`,
  `region` = excluded.`region`,
  `latitude` = excluded.`latitude`,
  `longitude` = excluded.`longitude`,
  `coordinate_source` = excluded.`coordinate_source`,
  `source_notes` = excluded.`source_notes`,
  `active` = excluded.`active`,
  `updated_at` = excluded.`updated_at`;

INSERT OR IGNORE INTO `d1_migrations` (`name`) VALUES ('0001_wushi_harbor_spot.sql');

CREATE TABLE IF NOT EXISTS `auth_sessions` (
  `id_hash` text PRIMARY KEY NOT NULL,
  `user_id` text NOT NULL,
  `expires_at` text NOT NULL,
  `created_at` text NOT NULL,
  `last_seen_at` text NOT NULL,
  FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON UPDATE no action ON DELETE no action
);

CREATE INDEX IF NOT EXISTS `auth_sessions_user_id_idx` ON `auth_sessions` (`user_id`);
CREATE INDEX IF NOT EXISTS `auth_sessions_expires_at_idx` ON `auth_sessions` (`expires_at`);

CREATE TABLE IF NOT EXISTS `oauth_attempts` (
  `state_hash` text PRIMARY KEY NOT NULL,
  `nonce` text NOT NULL,
  `code_verifier` text NOT NULL,
  `expires_at` text NOT NULL,
  `created_at` text NOT NULL
);

CREATE INDEX IF NOT EXISTS `oauth_attempts_expires_at_idx` ON `oauth_attempts` (`expires_at`);

INSERT OR IGNORE INTO `d1_migrations` (`name`) VALUES ('0002_sour_galactus.sql');
