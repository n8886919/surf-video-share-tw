CREATE TABLE `forecast_retention_state` (
	`id` text PRIMARY KEY NOT NULL,
	`cursor` integer DEFAULT 0 NOT NULL,
	`budget_day` text NOT NULL,
	`writes` integer DEFAULT 0 NOT NULL,
	`lease_token` text NOT NULL,
	`lease_until` text NOT NULL,
	`last_hour` text NOT NULL
);
