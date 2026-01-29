ALTER TABLE `site_settings` ADD `notify_downtime` integer;--> statement-breakpoint
ALTER TABLE `site_settings` ADD `notify_slow_response` integer;--> statement-breakpoint
ALTER TABLE `site_settings` ADD `notify_status_code` integer;--> statement-breakpoint
ALTER TABLE `site_settings` ADD `notify_content_change` integer;--> statement-breakpoint
ALTER TABLE `site_settings` ADD `notify_ssl_issue` integer;--> statement-breakpoint
ALTER TABLE `site_settings` ADD `notify_header_anomaly` integer;--> statement-breakpoint
ALTER TABLE `site_settings` ADD `severity_threshold` text;