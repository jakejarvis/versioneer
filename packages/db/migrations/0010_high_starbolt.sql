ALTER TABLE `discovered_apps` ADD `code_signing_authority` text;--> statement-breakpoint
ALTER TABLE `discovered_apps` ADD `app_category` text;--> statement-breakpoint
ALTER TABLE `discovered_apps` ADD `min_macos_version` text;--> statement-breakpoint
ALTER TABLE `discovered_apps` ADD `enrichment_status` text DEFAULT 'pending' NOT NULL;--> statement-breakpoint
ALTER TABLE `discovered_apps` ADD `enriched_at` text;--> statement-breakpoint
ALTER TABLE `discovered_apps` ADD `enrichment_error` text;--> statement-breakpoint
ALTER TABLE `discovered_apps` ADD `enriched_vendor_name` text;--> statement-breakpoint
ALTER TABLE `discovered_apps` ADD `enriched_homepage_url` text;--> statement-breakpoint
ALTER TABLE `discovered_apps` ADD `enriched_latest_version` text;--> statement-breakpoint
ALTER TABLE `discovered_apps` ADD `enriched_latest_published_at` text;--> statement-breakpoint
ALTER TABLE `discovered_apps` ADD `enriched_release_count` integer;--> statement-breakpoint
ALTER TABLE `discovered_apps` ADD `enriched_feed_title` text;--> statement-breakpoint
ALTER TABLE `discovered_apps` ADD `enriched_metadata_json` text;--> statement-breakpoint
ALTER TABLE `discovered_apps` ADD `source_validation_status` text DEFAULT 'untested' NOT NULL;--> statement-breakpoint
ALTER TABLE `discovered_apps` ADD `confidence_score` integer;--> statement-breakpoint
CREATE INDEX `idx_discovered_apps_enrichment_status` ON `discovered_apps` (`enrichment_status`);--> statement-breakpoint
CREATE INDEX `idx_discovered_apps_confidence_score` ON `discovered_apps` (`confidence_score`);