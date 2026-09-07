CREATE TABLE `journey_daily` (
	`day` text NOT NULL,
	`source` text NOT NULL,
	`event` text NOT NULL,
	`outcome` text NOT NULL,
	`count` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `journey_daily_key_idx` ON `journey_daily` (`day`,`source`,`event`,`outcome`);--> statement-breakpoint
CREATE TABLE `journey_events` (
	`id` text PRIMARY KEY NOT NULL,
	`trace_id` text NOT NULL,
	`event` text NOT NULL,
	`source` text NOT NULL,
	`details_json` text NOT NULL,
	`occurred_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `journey_events_time_idx` ON `journey_events` (`occurred_at`);--> statement-breakpoint
CREATE INDEX `journey_events_trace_idx` ON `journey_events` (`trace_id`,`occurred_at`);--> statement-breakpoint
CREATE TABLE `moderation_actions` (
	`id` text PRIMARY KEY NOT NULL,
	`actor_user_id` text NOT NULL,
	`target_type` text NOT NULL,
	`target_id` text NOT NULL,
	`action` text NOT NULL,
	`reason` text NOT NULL,
	`occurred_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `moderation_actions_time_idx` ON `moderation_actions` (`occurred_at`);--> statement-breakpoint
ALTER TABLE `video_reports` ADD `resolution_action` text;--> statement-breakpoint
ALTER TABLE `video_reports` ADD `resolution_reason` text;--> statement-breakpoint
ALTER TABLE `video_reports` ADD `resolution_id` text;