CREATE INDEX `idx_aliases_app_type_normalized` ON `app_aliases` (`app_id`,`alias_type`,`normalized_value`);--> statement-breakpoint
CREATE INDEX `idx_discovered_apps_pending_last_seen` ON `discovered_apps` (`status`,`enrichment_status`,`last_seen_at`);--> statement-breakpoint
CREATE INDEX `idx_discovered_apps_enrichment_updated_last_seen` ON `discovered_apps` (`status`,`enrichment_status`,`updated_at`,`last_seen_at`);--> statement-breakpoint
CREATE INDEX `idx_discovered_apps_in_progress_started_last_seen` ON `discovered_apps` (`status`,`enrichment_status`,`enrichment_started_at`,`last_seen_at`);--> statement-breakpoint
CREATE INDEX `idx_discovered_apps_success_enriched_last_seen` ON `discovered_apps` (`status`,`enrichment_status`,`enriched_at`,`last_seen_at`);--> statement-breakpoint
CREATE INDEX `idx_fetches_source_hostname` ON `source_fetches` (`source_id`,`fetch_hostname`);--> statement-breakpoint
CREATE INDEX `idx_sources_app_status_review_role_channel_success` ON `sources` (`app_id`,`status`,`review_status`,`role`,`channel`,`last_success_at`);--> statement-breakpoint
CREATE INDEX `idx_sources_app_type_base_url` ON `sources` (`app_id`,`source_type`,`base_url`);