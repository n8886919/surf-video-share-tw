CREATE TABLE `auth_diagnostic_events` (
	`id` text PRIMARY KEY NOT NULL,
	`trace_id` text NOT NULL,
	`kind` text NOT NULL,
	`details_json` text NOT NULL,
	`occurred_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `auth_diagnostic_trace_time_idx` ON `auth_diagnostic_events` (`trace_id`,`occurred_at`);--> statement-breakpoint
CREATE INDEX `auth_diagnostic_time_idx` ON `auth_diagnostic_events` (`occurred_at`);