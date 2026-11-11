CREATE TABLE `line_upload_drafts` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`message_id` text NOT NULL,
	`revision` integer DEFAULT 0 NOT NULL,
	`status` text DEFAULT 'draft' NOT NULL,
	`spot_id` text,
	`captured_at` text,
	`terms_version` text NOT NULL,
	`expires_at` text NOT NULL,
	`transfer_status` text DEFAULT 'queued' NOT NULL,
	`provider_video_id` text,
	`upload_url` text,
	`lease_token` text,
	`lease_until` text,
	`transfer_attempts` integer DEFAULT 0 NOT NULL,
	`error_code` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `line_upload_message_idx` ON `line_upload_drafts` (`message_id`);--> statement-breakpoint
CREATE INDEX `line_upload_expiry_idx` ON `line_upload_drafts` (`expires_at`);--> statement-breakpoint
CREATE INDEX `line_upload_user_idx` ON `line_upload_drafts` (`user_id`,`status`);