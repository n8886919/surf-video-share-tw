CREATE TABLE `forecast_snapshots` (
	`id` text PRIMARY KEY NOT NULL,
	`spot_id` text NOT NULL,
	`provider` text NOT NULL,
	`model` text NOT NULL,
	`issued_at` text NOT NULL,
	`model_run_at` text,
	`valid_at` text NOT NULL,
	`lead_hours` real,
	`grid_latitude` real,
	`grid_longitude` real,
	`wave_height` real,
	`wave_direction` real,
	`wave_period` real,
	`swell_height` real,
	`swell_direction` real,
	`swell_period` real,
	`secondary_swell_height` real,
	`secondary_swell_direction` real,
	`secondary_swell_period` real,
	`wind_wave_height` real,
	`wind_wave_direction` real,
	`wind_wave_period` real,
	`tide_height` real,
	`tide_slope` real,
	`tide_state` text,
	`wind_speed` real,
	`wind_direction` real,
	`wind_gust` real,
	`retrieved_at` text NOT NULL,
	`schema_version` integer NOT NULL,
	`raw_payload` text,
	`created_at` text NOT NULL,
	FOREIGN KEY (`spot_id`) REFERENCES `spots`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `forecast_spot_valid_at_idx` ON `forecast_snapshots` (`spot_id`,`valid_at`);--> statement-breakpoint
CREATE UNIQUE INDEX `forecast_source_run_idx` ON `forecast_snapshots` (`spot_id`,`provider`,`model`,`issued_at`,`valid_at`);--> statement-breakpoint
PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_videos` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`spot_id` text,
	`video_provider` text NOT NULL,
	`provider_video_id` text NOT NULL,
	`captured_at` text,
	`uploaded_at` text,
	`duration_seconds` real,
	`status` text NOT NULL,
	`show_uploader` integer NOT NULL,
	`metadata_status` text DEFAULT 'pending' NOT NULL,
	`metadata_expires_at` text,
	`public_at` text,
	`is_favorite` integer DEFAULT false NOT NULL,
	`uploader_note` text,
	`condition_snapshot_id` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`spot_id`) REFERENCES `spots`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`condition_snapshot_id`) REFERENCES `condition_snapshots`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
INSERT INTO `__new_videos`("id", "user_id", "spot_id", "video_provider", "provider_video_id", "captured_at", "uploaded_at", "duration_seconds", "status", "show_uploader", "metadata_status", "metadata_expires_at", "public_at", "is_favorite", "uploader_note", "condition_snapshot_id", "created_at", "updated_at") SELECT "id", "user_id", "spot_id", "video_provider", "provider_video_id", "captured_at", "uploaded_at", "duration_seconds", "status", "show_uploader", 'complete', NULL, COALESCE("uploaded_at", "created_at"), 0, NULL, "condition_snapshot_id", "created_at", "updated_at" FROM `videos`;--> statement-breakpoint
DROP TABLE `videos`;--> statement-breakpoint
ALTER TABLE `__new_videos` RENAME TO `videos`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE INDEX `videos_spot_captured_at_idx` ON `videos` (`spot_id`,`captured_at`);--> statement-breakpoint
CREATE INDEX `videos_condition_snapshot_idx` ON `videos` (`condition_snapshot_id`);--> statement-breakpoint
CREATE INDEX `videos_public_spot_captured_at_idx` ON `videos` (`public_at`,`spot_id`,`captured_at`);--> statement-breakpoint
CREATE INDEX `videos_metadata_expires_at_idx` ON `videos` (`metadata_expires_at`);--> statement-breakpoint
CREATE UNIQUE INDEX `videos_provider_video_idx` ON `videos` (`video_provider`,`provider_video_id`);--> statement-breakpoint
ALTER TABLE `condition_snapshots` ADD `wind_wave_height` real;--> statement-breakpoint
ALTER TABLE `condition_snapshots` ADD `wind_wave_direction` real;--> statement-breakpoint
ALTER TABLE `condition_snapshots` ADD `wind_wave_period` real;--> statement-breakpoint
ALTER TABLE `condition_snapshots` ADD `wind_gust` real;--> statement-breakpoint
ALTER TABLE `condition_snapshots` ADD `tide_slope` real;
--> statement-breakpoint
INSERT INTO `spots` (
  `id`, `slug`, `name_en`, `name_zh`, `region`, `latitude`, `longitude`,
  `coordinate_source`, `source_notes`, `active`, `created_at`, `updated_at`
) VALUES (
  'spot_double-lions',
  'double-lions',
  'Double Lions',
  '雙獅',
  'Northeast',
  24.8887597,
  121.8495724,
  'https://maps.app.goo.gl/CJTEVfSH7yFGnHKPA',
  'User-supplied Google Maps place marker',
  1,
  CURRENT_TIMESTAMP,
  CURRENT_TIMESTAMP
)
ON CONFLICT(`slug`) DO UPDATE SET
  `name_en` = excluded.`name_en`,
  `name_zh` = excluded.`name_zh`,
  `region` = excluded.`region`,
  `latitude` = excluded.`latitude`,
  `longitude` = excluded.`longitude`,
  `coordinate_source` = excluded.`coordinate_source`,
  `source_notes` = excluded.`source_notes`,
  `active` = excluded.`active`,
  `updated_at` = excluded.`updated_at`;
