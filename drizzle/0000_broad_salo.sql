CREATE TABLE `anomalies` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`check_id` integer NOT NULL,
	`site_id` integer NOT NULL,
	`type` text NOT NULL,
	`description` text,
	`severity` text NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`check_id`) REFERENCES `checks`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`site_id`) REFERENCES `sites`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `anomalies_check_id_idx` ON `anomalies` (`check_id`);--> statement-breakpoint
CREATE INDEX `anomalies_site_id_idx` ON `anomalies` (`site_id`);--> statement-breakpoint
CREATE INDEX `anomalies_type_idx` ON `anomalies` (`type`);--> statement-breakpoint
CREATE INDEX `anomalies_site_type_idx` ON `anomalies` (`site_id`,`type`);--> statement-breakpoint
CREATE TABLE `checks` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`site_id` integer NOT NULL,
	`status_code` integer,
	`response_time_ms` integer,
	`is_up` integer,
	`error_message` text,
	`headers_snapshot` text,
	`body_hash` text,
	`ssl_valid` integer,
	`ssl_expiry` integer,
	`checked_at` integer NOT NULL,
	FOREIGN KEY (`site_id`) REFERENCES `sites`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `checks_site_id_idx` ON `checks` (`site_id`);--> statement-breakpoint
CREATE INDEX `checks_checked_at_idx` ON `checks` (`checked_at`);--> statement-breakpoint
CREATE INDEX `checks_site_checked_idx` ON `checks` (`site_id`,`checked_at`);--> statement-breakpoint
CREATE TABLE `sites` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`url` text NOT NULL,
	`name` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`is_active` integer DEFAULT true NOT NULL
);
