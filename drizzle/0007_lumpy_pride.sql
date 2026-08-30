CREATE TABLE `video_playback_events` (
	`id` text PRIMARY KEY NOT NULL,
	`video_id` text NOT NULL,
	`started_at` text NOT NULL,
	FOREIGN KEY (`video_id`) REFERENCES `videos`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `video_playback_events_video_started_idx` ON `video_playback_events` (`video_id`,`started_at`);--> statement-breakpoint
CREATE INDEX `video_playback_events_started_at_idx` ON `video_playback_events` (`started_at`);
