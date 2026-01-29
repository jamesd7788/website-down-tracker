CREATE TABLE `site_settings` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`site_id` integer NOT NULL,
	`response_time_threshold` integer,
	`ssl_expiry_warning_days` integer,
	`check_interval` integer,
	`custom_name` text,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`site_id`) REFERENCES `sites`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `site_settings_site_id_unique` ON `site_settings` (`site_id`);