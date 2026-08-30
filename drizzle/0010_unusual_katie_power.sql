CREATE TABLE `ops_analysis_runs` (
	`id` text PRIMARY KEY NOT NULL,
	`window_start` text NOT NULL,
	`window_end` text NOT NULL,
	`status` text NOT NULL,
	`severity` text NOT NULL,
	`event_count` integer NOT NULL,
	`summary_zh` text NOT NULL,
	`patterns_json` text NOT NULL,
	`recommended_checks_json` text NOT NULL,
	`notified_at` text,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `ops_analysis_runs_window_idx` ON `ops_analysis_runs` (`window_start`,`window_end`);--> statement-breakpoint
CREATE INDEX `ops_analysis_runs_created_at_idx` ON `ops_analysis_runs` (`created_at`);--> statement-breakpoint
CREATE TABLE `ops_events` (
	`id` text PRIMARY KEY NOT NULL,
	`event_code` text NOT NULL,
	`severity` text NOT NULL,
	`source` text NOT NULL,
	`fingerprint` text NOT NULL,
	`request_id` text,
	`route` text,
	`error_name` text,
	`summary` text,
	`occurred_at` text NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `ops_events_occurred_at_idx` ON `ops_events` (`occurred_at`);--> statement-breakpoint
CREATE INDEX `ops_events_severity_occurred_at_idx` ON `ops_events` (`severity`,`occurred_at`);--> statement-breakpoint
CREATE INDEX `ops_events_fingerprint_occurred_at_idx` ON `ops_events` (`fingerprint`,`occurred_at`);--> statement-breakpoint
CREATE TABLE `ops_incidents` (
	`fingerprint` text PRIMARY KEY NOT NULL,
	`status` text NOT NULL,
	`severity` text NOT NULL,
	`title` text NOT NULL,
	`first_seen_at` text NOT NULL,
	`last_seen_at` text NOT NULL,
	`occurrences` integer DEFAULT 1 NOT NULL,
	`notified_at` text,
	`recovered_at` text,
	`recovery_notified_at` text,
	`updated_at` text NOT NULL
);
