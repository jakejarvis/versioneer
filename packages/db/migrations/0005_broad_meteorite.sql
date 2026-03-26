CREATE TABLE `discovered_apps` (
	`id` text PRIMARY KEY NOT NULL,
	`lookup_key` text NOT NULL,
	`app_name` text NOT NULL,
	`bundle_id` text,
	`team_id` text,
	`sighting_count` integer DEFAULT 1 NOT NULL,
	`first_seen_at` text NOT NULL,
	`last_seen_at` text NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`onboarded_app_id` text,
	`dismissed_at` text,
	`dismissed_by` text,
	`sample_versions` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`onboarded_app_id`) REFERENCES `apps`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `discovered_apps_lookup_key_unique` ON `discovered_apps` (`lookup_key`);--> statement-breakpoint
CREATE UNIQUE INDEX `idx_discovered_apps_lookup_key` ON `discovered_apps` (`lookup_key`);--> statement-breakpoint
CREATE INDEX `idx_discovered_apps_status` ON `discovered_apps` (`status`);--> statement-breakpoint
CREATE INDEX `idx_discovered_apps_sighting_count` ON `discovered_apps` (`sighting_count`);