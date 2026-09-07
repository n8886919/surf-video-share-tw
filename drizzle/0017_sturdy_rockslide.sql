ALTER TABLE `oauth_attempts` ADD `browser_proof_hash` text;--> statement-breakpoint
ALTER TABLE `oauth_attempts` ADD `status` text DEFAULT 'pending' NOT NULL;--> statement-breakpoint
ALTER TABLE `oauth_attempts` ADD `result_user_id` text REFERENCES users(id);--> statement-breakpoint
ALTER TABLE `oauth_attempts` ADD `failure` text;--> statement-breakpoint
ALTER TABLE `oauth_attempts` ADD `delivered_at` text;--> statement-breakpoint
ALTER TABLE `oauth_attempts` ADD `trace_id` text;--> statement-breakpoint
CREATE UNIQUE INDEX `oauth_attempts_browser_proof_idx` ON `oauth_attempts` (`browser_proof_hash`);