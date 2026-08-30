CREATE TABLE `share_playback_budgets` (
	`id` text PRIMARY KEY NOT NULL,
	`exporter_user_id` text NOT NULL,
	`period` text NOT NULL,
	`used` integer DEFAULT 0 NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`exporter_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `share_playback_budgets_exporter_period_idx` ON `share_playback_budgets` (`exporter_user_id`,`period`);