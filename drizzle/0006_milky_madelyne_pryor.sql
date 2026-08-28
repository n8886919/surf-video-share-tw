CREATE TABLE `problem_reports` (
	`id` text PRIMARY KEY NOT NULL,
	`message` text NOT NULL,
	`view` text NOT NULL,
	`status` text DEFAULT 'open' NOT NULL,
	`created_at` text NOT NULL,
	`resolved_at` text,
	`resolved_by_user_id` text,
	FOREIGN KEY (`resolved_by_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `problem_reports_status_created_at_idx` ON `problem_reports` (`status`,`created_at`);