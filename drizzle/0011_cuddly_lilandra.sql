ALTER TABLE `forecast_snapshots` ADD `snapshot_kind` text DEFAULT 'forecast' NOT NULL;--> statement-breakpoint
ALTER TABLE `forecast_snapshots` ADD `wave_peak_period` real;--> statement-breakpoint
ALTER TABLE `forecast_snapshots` ADD `total_swell_height` real;--> statement-breakpoint
ALTER TABLE `forecast_snapshots` ADD `total_swell_direction` real;--> statement-breakpoint
ALTER TABLE `forecast_snapshots` ADD `total_swell_period` real;--> statement-breakpoint
ALTER TABLE `forecast_snapshots` ADD `total_swell_peak_period` real;--> statement-breakpoint
ALTER TABLE `forecast_snapshots` ADD `swell_peak_period` real;--> statement-breakpoint
ALTER TABLE `forecast_snapshots` ADD `tertiary_swell_height` real;--> statement-breakpoint
ALTER TABLE `forecast_snapshots` ADD `tertiary_swell_direction` real;--> statement-breakpoint
ALTER TABLE `forecast_snapshots` ADD `tertiary_swell_period` real;--> statement-breakpoint
ALTER TABLE `forecast_snapshots` ADD `wind_wave_peak_period` real;