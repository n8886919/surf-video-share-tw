ALTER TABLE `videos` ADD `client_file_sha256` text;--> statement-breakpoint
ALTER TABLE `videos` ADD `client_file_size_bytes` integer;--> statement-breakpoint
CREATE INDEX `videos_recent_file_hash_idx` ON `videos` (`client_file_sha256`,`client_file_size_bytes`,`uploaded_at`) WHERE "videos"."client_file_sha256" IS NOT NULL;