CREATE TABLE `video_reports` (
	`id` text PRIMARY KEY NOT NULL,
	`video_id` text NOT NULL,
	`reason` text NOT NULL,
	`status` text DEFAULT 'open' NOT NULL,
	`created_at` text NOT NULL,
	`resolved_at` text,
	`resolved_by_user_id` text,
	FOREIGN KEY (`video_id`) REFERENCES `videos`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`resolved_by_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `video_reports_status_created_at_idx` ON `video_reports` (`status`,`created_at`);--> statement-breakpoint
CREATE INDEX `video_reports_video_id_idx` ON `video_reports` (`video_id`);--> statement-breakpoint
ALTER TABLE `videos` ADD `fun_reaction` text;--> statement-breakpoint
ALTER TABLE `videos` ADD `terms_version` text;--> statement-breakpoint
ALTER TABLE `videos` ADD `moderation_status` text DEFAULT 'visible' NOT NULL;--> statement-breakpoint
ALTER TABLE `videos` ADD `delisted_at` text;--> statement-breakpoint
ALTER TABLE `videos` ADD `delisted_reason` text;--> statement-breakpoint
UPDATE `videos` SET `public_at` = NULL WHERE `terms_version` IS NULL;--> statement-breakpoint
CREATE INDEX `videos_public_lookup_idx` ON `videos` (`moderation_status`,`public_at`,`spot_id`,`captured_at`);
