CREATE TABLE `forecast_ingestion_notifications` (
	`notification_key` text PRIMARY KEY NOT NULL,
	`provider` text NOT NULL,
	`model` text NOT NULL,
	`issued_at` text NOT NULL,
	`model_run_at` text NOT NULL,
	`status` text NOT NULL,
	`attempts` integer DEFAULT 1 NOT NULL,
	`claimed_at` text NOT NULL,
	`sent_at` text,
	`last_error` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `forecast_ingestion_notifications_source_run_idx` ON `forecast_ingestion_notifications` (`provider`,`model`,`model_run_at`);--> statement-breakpoint
CREATE INDEX `forecast_ingestion_notifications_status_idx` ON `forecast_ingestion_notifications` (`status`,`updated_at`);