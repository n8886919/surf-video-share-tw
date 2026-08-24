CREATE TABLE `condition_snapshots` (
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
--> statement-breakpoint
CREATE TABLE `spots` (
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
--> statement-breakpoint
CREATE UNIQUE INDEX `spots_slug_idx` ON `spots` (`slug`);--> statement-breakpoint
CREATE TABLE `users` (
	`id` text PRIMARY KEY NOT NULL,
	`line_subject` text NOT NULL,
	`display_id` text,
	`show_identity_default` integer DEFAULT false NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `users_line_subject_idx` ON `users` (`line_subject`);--> statement-breakpoint
CREATE TABLE `videos` (
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
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`spot_id`) REFERENCES `spots`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`condition_snapshot_id`) REFERENCES `condition_snapshots`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `videos_spot_captured_at_idx` ON `videos` (`spot_id`,`captured_at`);--> statement-breakpoint
CREATE INDEX `videos_condition_snapshot_idx` ON `videos` (`condition_snapshot_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `videos_provider_video_idx` ON `videos` (`video_provider`,`provider_video_id`);