ALTER TABLE `discovered_apps` ADD `enrichment_started_at` text;--> statement-breakpoint
CREATE INDEX `idx_discovered_apps_review_enrichment` ON `discovered_apps` (`status`,`enrichment_status`,`enrichment_started_at`,`enriched_at`,`last_seen_at`);--> statement-breakpoint
CREATE INDEX `idx_discovered_apps_queue` ON `discovered_apps` (`status`,`enrichment_status`,`confidence_score`,`sighting_count`,`last_seen_at`);--> statement-breakpoint
ALTER TABLE `job_failures` ADD `dedupe_key` text;--> statement-breakpoint
CREATE INDEX `idx_job_failures_status_created` ON `job_failures` (`status`,`created_at`);--> statement-breakpoint
CREATE INDEX `idx_job_failures_status_type_created` ON `job_failures` (`status`,`job_type`,`created_at`);--> statement-breakpoint
CREATE UNIQUE INDEX `idx_job_failures_active_dedupe` ON `job_failures` (`dedupe_key`) WHERE "job_failures"."dedupe_key" is not null and "job_failures"."status" in ('open', 'retrying');--> statement-breakpoint
ALTER TABLE `sources` ADD `next_poll_at` text;--> statement-breakpoint
UPDATE `sources`
SET `next_poll_at` = CASE
  WHEN `status` = 'active' AND `last_fetched_at` IS NOT NULL
    THEN strftime('%Y-%m-%dT%H:%M:%fZ', datetime(`last_fetched_at`, '+' || `poll_interval_minutes` || ' minutes'))
  WHEN `status` = 'active'
    THEN `created_at`
  ELSE NULL
END;--> statement-breakpoint
CREATE INDEX `idx_sources_due_poll` ON `sources` (`status`,`next_poll_at`);--> statement-breakpoint
CREATE INDEX `idx_feedback_status_created` ON `client_feedback` (`status`,`created_at`);--> statement-breakpoint
CREATE INDEX `idx_feedback_type_created` ON `client_feedback` (`feedback_type`,`created_at`);--> statement-breakpoint
CREATE INDEX `idx_audit_created` ON `audit_log` (`created_at`);--> statement-breakpoint
CREATE INDEX `idx_audit_event_created` ON `audit_log` (`event_type`,`created_at`);--> statement-breakpoint
CREATE INDEX `idx_audit_target_created` ON `audit_log` (`target_type`,`target_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `idx_cron_job_runs_status_started` ON `cron_job_runs` (`status`,`started_at`);--> statement-breakpoint
CREATE INDEX `idx_cron_job_runs_type_status_trigger_started` ON `cron_job_runs` (`job_type`,`status`,`trigger`,`started_at`);--> statement-breakpoint
CREATE UNIQUE INDEX `idx_artifacts_release_url_hash` ON `artifacts` (`release_id`,`url_hash`);--> statement-breakpoint
CREATE UNIQUE INDEX `idx_releases_app_channel_version` ON `releases` (`app_id`,`channel`,`version_normalized`);--> statement-breakpoint
CREATE INDEX `idx_releases_status_created` ON `releases` (`status`,`created_at`);--> statement-breakpoint
CREATE INDEX `idx_catalog_suggestions_queue` ON `catalog_suggestions` (`status`,`queue_type`,`first_seen_at`,`created_at`);--> statement-breakpoint
CREATE INDEX `idx_catalog_suggestions_last_seen` ON `catalog_suggestions` (`status`,`last_seen_at`);--> statement-breakpoint
CREATE INDEX `idx_trust_assertions_lookup` ON `trust_assertions` (`assertion_type`,`app_id`,`source_id`,`value`);--> statement-breakpoint
CREATE INDEX `idx_parser_runs_fetch_started` ON `parser_runs` (`source_fetch_id`,`started_at`);--> statement-breakpoint
CREATE INDEX `idx_fetches_source_fetched` ON `source_fetches` (`source_id`,`fetched_at`);
