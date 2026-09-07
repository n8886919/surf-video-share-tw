CREATE TABLE `forecast_daily_reports` (
	`report_day` text PRIMARY KEY NOT NULL,
	`message` text NOT NULL,
	`recipient_hash` text NOT NULL,
	`retry_key` text NOT NULL,
	`status` text NOT NULL,
	`claim_token` text,
	`claimed_at` text,
	`sent_at` text,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `forecast_update_runs` (
	`run_key` text PRIMARY KEY NOT NULL,
	`source` text NOT NULL,
	`slot_at` text NOT NULL,
	`started_at` text NOT NULL,
	`completed_at` text
);
--> statement-breakpoint
CREATE UNIQUE INDEX `forecast_update_runs_source_slot_idx` ON `forecast_update_runs` (`source`,`slot_at`);--> statement-breakpoint
CREATE INDEX `forecast_completion_run_idx` ON `forecast_snapshots` (`provider`,`model`,`model_run_at`,`spot_id`,`lead_hours`) WHERE "forecast_snapshots"."model_run_at" IS NOT NULL;