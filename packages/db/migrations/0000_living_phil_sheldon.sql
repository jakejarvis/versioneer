CREATE TABLE `admin_accounts` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`account_id` text NOT NULL,
	`provider_id` text NOT NULL,
	`access_token` text,
	`refresh_token` text,
	`access_token_expires_at` integer,
	`refresh_token_expires_at` integer,
	`scope` text,
	`id_token` text,
	`password` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `admin_users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `admin_sessions` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`token` text NOT NULL,
	`expires_at` integer NOT NULL,
	`ip_address` text,
	`user_agent` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `admin_users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `admin_sessions_token_unique` ON `admin_sessions` (`token`);--> statement-breakpoint
CREATE TABLE `admin_users` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`email` text NOT NULL,
	`email_verified` integer NOT NULL,
	`image` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `admin_users_email_unique` ON `admin_users` (`email`);--> statement-breakpoint
CREATE TABLE `admin_verifications` (
	`id` text PRIMARY KEY NOT NULL,
	`identifier` text NOT NULL,
	`value` text NOT NULL,
	`expires_at` integer NOT NULL,
	`created_at` integer,
	`updated_at` integer
);
--> statement-breakpoint
CREATE TABLE `app_aliases` (
	`id` text PRIMARY KEY NOT NULL,
	`app_id` text NOT NULL,
	`alias_type` text NOT NULL,
	`value` text NOT NULL,
	`normalized_value` text NOT NULL,
	`is_exact` integer DEFAULT true NOT NULL,
	`priority` integer DEFAULT 0 NOT NULL,
	`confidence_weight` integer DEFAULT 100 NOT NULL,
	`source` text,
	`is_active` integer DEFAULT true NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`app_id`) REFERENCES `apps`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `idx_aliases_app_id` ON `app_aliases` (`app_id`);--> statement-breakpoint
CREATE INDEX `idx_aliases_type_value` ON `app_aliases` (`alias_type`,`normalized_value`);--> statement-breakpoint
CREATE INDEX `idx_aliases_type_active` ON `app_aliases` (`alias_type`,`is_active`);--> statement-breakpoint
CREATE UNIQUE INDEX `idx_aliases_unique_active_exact_bundle_id` ON `app_aliases` (`alias_type`,`normalized_value`) WHERE "app_aliases"."is_active" = 1 and "app_aliases"."is_exact" = 1 and "app_aliases"."alias_type" = 'bundle_id';--> statement-breakpoint
CREATE UNIQUE INDEX `idx_aliases_unique_active_exact_sparkle_feed` ON `app_aliases` (`alias_type`,`normalized_value`) WHERE "app_aliases"."is_active" = 1 and "app_aliases"."is_exact" = 1 and "app_aliases"."alias_type" = 'sparkle_feed';--> statement-breakpoint
CREATE UNIQUE INDEX `idx_aliases_unique_active_exact_mas_app_id` ON `app_aliases` (`alias_type`,`normalized_value`) WHERE "app_aliases"."is_active" = 1 and "app_aliases"."is_exact" = 1 and "app_aliases"."alias_type" = 'mas_app_id';--> statement-breakpoint
CREATE UNIQUE INDEX `idx_aliases_unique_active_exact_homebrew_cask` ON `app_aliases` (`alias_type`,`normalized_value`) WHERE "app_aliases"."is_active" = 1 and "app_aliases"."is_exact" = 1 and "app_aliases"."alias_type" = 'homebrew_cask';--> statement-breakpoint
CREATE TABLE `apps` (
	`id` text PRIMARY KEY NOT NULL,
	`slug` text NOT NULL,
	`canonical_name` text NOT NULL,
	`vendor_name` text,
	`homepage_url` text,
	`status` text DEFAULT 'draft' NOT NULL,
	`merged_into_app_id` text,
	`notes` text,
	`default_release_notes_url` text,
	`icon_r2_key` text,
	`public_tracked_at` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `apps_slug_unique` ON `apps` (`slug`);--> statement-breakpoint
CREATE INDEX `idx_apps_slug` ON `apps` (`slug`);--> statement-breakpoint
CREATE INDEX `idx_apps_status` ON `apps` (`status`);--> statement-breakpoint
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
	`linked_app_id` text,
	`dismissed_at` text,
	`dismissed_by` text,
	`sample_versions` text,
	`sparkle_feed_url` text,
	`sparkle_public_key` text,
	`is_sparkle_app` integer,
	`is_mas_app` integer,
	`is_electron_app` integer,
	`electron_update_provider` text,
	`electron_update_url` text,
	`code_signing_authority` text,
	`app_category` text,
	`min_macos_version` text,
	`homebrew_cask_token` text,
	`homebrew_cask_version` text,
	`homebrew_cask_appcast_url` text,
	`homebrew_cask_homepage` text,
	`homebrew_cask_matched_at` text,
	`enrichment_status` text DEFAULT 'pending' NOT NULL,
	`enriched_at` text,
	`enrichment_error` text,
	`enriched_vendor_name` text,
	`enriched_homepage_url` text,
	`enriched_latest_version` text,
	`enriched_latest_published_at` text,
	`enriched_release_count` integer,
	`enriched_feed_title` text,
	`enriched_metadata_json` text,
	`source_validation_status` text DEFAULT 'untested' NOT NULL,
	`latest_reason_code` text,
	`primary_suggestion_id` text,
	`confidence_score` integer,
	`icon_r2_key` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`linked_app_id`) REFERENCES `apps`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `discovered_apps_lookup_key_unique` ON `discovered_apps` (`lookup_key`);--> statement-breakpoint
CREATE UNIQUE INDEX `idx_discovered_apps_lookup_key` ON `discovered_apps` (`lookup_key`);--> statement-breakpoint
CREATE INDEX `idx_discovered_apps_status` ON `discovered_apps` (`status`);--> statement-breakpoint
CREATE INDEX `idx_discovered_apps_sighting_count` ON `discovered_apps` (`sighting_count`);--> statement-breakpoint
CREATE INDEX `idx_discovered_apps_enrichment_status` ON `discovered_apps` (`enrichment_status`);--> statement-breakpoint
CREATE INDEX `idx_discovered_apps_confidence_score` ON `discovered_apps` (`confidence_score`);--> statement-breakpoint
CREATE TABLE `client_feedback` (
	`id` text PRIMARY KEY NOT NULL,
	`feedback_type` text NOT NULL,
	`target_app_id` text,
	`bundle_id` text,
	`app_name` text,
	`payload_json` text,
	`status` text DEFAULT 'new' NOT NULL,
	`resolved_at` text,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_feedback_status` ON `client_feedback` (`status`);--> statement-breakpoint
CREATE INDEX `idx_feedback_type` ON `client_feedback` (`feedback_type`);--> statement-breakpoint
CREATE INDEX `idx_feedback_target_app` ON `client_feedback` (`target_app_id`);--> statement-breakpoint
CREATE TABLE `audit_log` (
	`id` text PRIMARY KEY NOT NULL,
	`event_type` text NOT NULL,
	`actor_type` text NOT NULL,
	`actor_id` text,
	`target_type` text,
	`target_id` text,
	`payload_json` text,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_audit_event_type` ON `audit_log` (`event_type`);--> statement-breakpoint
CREATE INDEX `idx_audit_target` ON `audit_log` (`target_type`,`target_id`);--> statement-breakpoint
CREATE TABLE `cron_job_runs` (
	`id` text PRIMARY KEY NOT NULL,
	`job_type` text NOT NULL,
	`trigger` text NOT NULL,
	`status` text DEFAULT 'running' NOT NULL,
	`actor_id` text,
	`items_queued` integer,
	`items_total` integer,
	`result_json` text,
	`error_message` text,
	`started_at` text NOT NULL,
	`completed_at` text
);
--> statement-breakpoint
CREATE INDEX `idx_cron_job_runs_type` ON `cron_job_runs` (`job_type`);--> statement-breakpoint
CREATE INDEX `idx_cron_job_runs_started` ON `cron_job_runs` (`started_at`);--> statement-breakpoint
CREATE TABLE `install_executions` (
	`id` text PRIMARY KEY NOT NULL,
	`app_id` text NOT NULL,
	`release_id` text NOT NULL,
	`artifact_id` text,
	`client_platform` text NOT NULL,
	`client_app_version` text,
	`client_os_version` text,
	`client_system_architecture` text,
	`channel` text,
	`install_strategy` text NOT NULL,
	`execution_route` text,
	`status` text DEFAULT 'prepared' NOT NULL,
	`expected_bundle_id` text,
	`expected_team_id` text,
	`previous_version` text,
	`installed_version` text,
	`error_message` text,
	`verification_json` text,
	`prepared_at` text NOT NULL,
	`completed_at` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`app_id`) REFERENCES `apps`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`release_id`) REFERENCES `releases`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `idx_install_executions_app_id` ON `install_executions` (`app_id`);--> statement-breakpoint
CREATE INDEX `idx_install_executions_release_id` ON `install_executions` (`release_id`);--> statement-breakpoint
CREATE INDEX `idx_install_executions_status` ON `install_executions` (`status`);--> statement-breakpoint
CREATE INDEX `idx_install_executions_completed_at` ON `install_executions` (`completed_at`);--> statement-breakpoint
CREATE TABLE `job_failures` (
	`id` text PRIMARY KEY NOT NULL,
	`job_type` text NOT NULL,
	`job_key` text,
	`related_id` text,
	`error_message` text,
	`retry_count` integer DEFAULT 0 NOT NULL,
	`status` text DEFAULT 'open' NOT NULL,
	`created_at` text NOT NULL,
	`resolved_at` text
);
--> statement-breakpoint
CREATE INDEX `idx_job_failures_status` ON `job_failures` (`status`);--> statement-breakpoint
CREATE INDEX `idx_job_failures_type` ON `job_failures` (`job_type`);--> statement-breakpoint
CREATE TABLE `app_latest_releases` (
	`id` text PRIMARY KEY NOT NULL,
	`app_id` text NOT NULL,
	`channel` text DEFAULT 'stable' NOT NULL,
	`release_id` text NOT NULL,
	`authority_source_id` text,
	`artifact_id` text,
	`version_normalized` text NOT NULL,
	`version_raw` text NOT NULL,
	`released_at` text,
	`install_strategy` text,
	`pinned_release_id` text,
	`pinned_at` text,
	`pinned_by` text,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`app_id`) REFERENCES `apps`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`release_id`) REFERENCES `releases`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`authority_source_id`) REFERENCES `sources`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_latest_app_channel` ON `app_latest_releases` (`app_id`,`channel`);--> statement-breakpoint
CREATE TABLE `artifacts` (
	`id` text PRIMARY KEY NOT NULL,
	`release_id` text NOT NULL,
	`artifact_type` text NOT NULL,
	`url` text NOT NULL,
	`url_hash` text,
	`sha256` text,
	`size_bytes` integer,
	`architecture` text,
	`min_os_version` text,
	`is_primary` integer DEFAULT false NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`release_id`) REFERENCES `releases`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `idx_artifacts_release_id` ON `artifacts` (`release_id`);--> statement-breakpoint
CREATE TABLE `release_observations` (
	`id` text PRIMARY KEY NOT NULL,
	`parser_run_id` text NOT NULL,
	`app_id` text NOT NULL,
	`release_id` text,
	`observed_version_raw` text NOT NULL,
	`observed_version_normalized` text,
	`observed_build_number` text,
	`observed_channel` text,
	`observed_published_at` text,
	`observed_release_notes_url` text,
	`observed_download_url` text,
	`confidence` integer,
	`observation_json` text,
	`created_at` text NOT NULL,
	FOREIGN KEY (`parser_run_id`) REFERENCES `parser_runs`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`app_id`) REFERENCES `apps`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `idx_observations_parser_run` ON `release_observations` (`parser_run_id`);--> statement-breakpoint
CREATE INDEX `idx_observations_app_id` ON `release_observations` (`app_id`);--> statement-breakpoint
CREATE INDEX `idx_observations_release_id` ON `release_observations` (`release_id`);--> statement-breakpoint
CREATE TABLE `releases` (
	`id` text PRIMARY KEY NOT NULL,
	`app_id` text NOT NULL,
	`version_raw` text NOT NULL,
	`version_normalized` text NOT NULL,
	`build_number` text,
	`channel` text DEFAULT 'stable' NOT NULL,
	`released_at` text,
	`is_prerelease` integer DEFAULT false NOT NULL,
	`source_confidence` integer,
	`published_by_source_id` text,
	`status` text DEFAULT 'active' NOT NULL,
	`release_notes_html` text,
	`release_notes_url` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`app_id`) REFERENCES `apps`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`published_by_source_id`) REFERENCES `sources`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `idx_releases_app_id` ON `releases` (`app_id`);--> statement-breakpoint
CREATE INDEX `idx_releases_app_channel` ON `releases` (`app_id`,`channel`);--> statement-breakpoint
CREATE INDEX `idx_releases_version` ON `releases` (`app_id`,`version_normalized`);--> statement-breakpoint
CREATE INDEX `idx_releases_status` ON `releases` (`status`);--> statement-breakpoint
CREATE TABLE `catalog_suggestions` (
	`id` text PRIMARY KEY NOT NULL,
	`queue_type` text NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`app_id` text,
	`source_id` text,
	`bundle_key` text,
	`dedupe_key` text NOT NULL,
	`title` text NOT NULL,
	`canonical_snapshot_json` text,
	`proposed_change_json` text NOT NULL,
	`evidence_summary_json` text,
	`evidence_count` integer DEFAULT 0 NOT NULL,
	`first_seen_at` text NOT NULL,
	`last_seen_at` text NOT NULL,
	`reviewed_at` text,
	`reviewed_by` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`app_id`) REFERENCES `apps`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`source_id`) REFERENCES `sources`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_catalog_suggestions_dedupe_key` ON `catalog_suggestions` (`dedupe_key`);--> statement-breakpoint
CREATE INDEX `idx_catalog_suggestions_status` ON `catalog_suggestions` (`status`);--> statement-breakpoint
CREATE INDEX `idx_catalog_suggestions_queue_type` ON `catalog_suggestions` (`queue_type`);--> statement-breakpoint
CREATE INDEX `idx_catalog_suggestions_created_at` ON `catalog_suggestions` (`created_at`);--> statement-breakpoint
CREATE INDEX `idx_catalog_suggestions_bundle_key` ON `catalog_suggestions` (`bundle_key`);--> statement-breakpoint
CREATE INDEX `idx_catalog_suggestions_app_id` ON `catalog_suggestions` (`app_id`);--> statement-breakpoint
CREATE TABLE `suggestion_evidence` (
	`id` text PRIMARY KEY NOT NULL,
	`suggestion_id` text NOT NULL,
	`app_id` text,
	`source_id` text,
	`evidence_type` text NOT NULL,
	`fingerprint` text NOT NULL,
	`payload_json` text NOT NULL,
	`observed_at` text NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`suggestion_id`) REFERENCES `catalog_suggestions`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`app_id`) REFERENCES `apps`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`source_id`) REFERENCES `sources`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_suggestion_evidence_fingerprint` ON `suggestion_evidence` (`suggestion_id`,`fingerprint`);--> statement-breakpoint
CREATE INDEX `idx_suggestion_evidence_suggestion_id` ON `suggestion_evidence` (`suggestion_id`);--> statement-breakpoint
CREATE INDEX `idx_suggestion_evidence_type` ON `suggestion_evidence` (`evidence_type`);--> statement-breakpoint
CREATE TABLE `trust_assertions` (
	`id` text PRIMARY KEY NOT NULL,
	`app_id` text,
	`source_id` text,
	`assertion_type` text NOT NULL,
	`value` text NOT NULL,
	`reviewed_at` text,
	`reviewed_by` text,
	`created_at` text NOT NULL,
	FOREIGN KEY (`app_id`) REFERENCES `apps`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`source_id`) REFERENCES `sources`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `idx_trust_assertions_app_id` ON `trust_assertions` (`app_id`);--> statement-breakpoint
CREATE INDEX `idx_trust_assertions_source_id` ON `trust_assertions` (`source_id`);--> statement-breakpoint
CREATE INDEX `idx_trust_assertions_type` ON `trust_assertions` (`assertion_type`);--> statement-breakpoint
CREATE TABLE `parser_runs` (
	`id` text PRIMARY KEY NOT NULL,
	`source_fetch_id` text NOT NULL,
	`parser_key` text NOT NULL,
	`parser_version` text NOT NULL,
	`run_status` text NOT NULL,
	`observation_count` integer DEFAULT 0 NOT NULL,
	`confidence` integer,
	`error_message` text,
	`started_at` text NOT NULL,
	`finished_at` text,
	FOREIGN KEY (`source_fetch_id`) REFERENCES `source_fetches`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `idx_parser_runs_fetch_id` ON `parser_runs` (`source_fetch_id`);--> statement-breakpoint
CREATE TABLE `source_fetches` (
	`id` text PRIMARY KEY NOT NULL,
	`source_id` text NOT NULL,
	`fetch_status` text NOT NULL,
	`http_status` integer,
	`etag` text,
	`last_modified` text,
	`content_type` text,
	`content_length` integer,
	`content_hash` text,
	`r2_key` text,
	`error_message` text,
	`fetched_at` text NOT NULL,
	FOREIGN KEY (`source_id`) REFERENCES `sources`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `idx_fetches_source_id` ON `source_fetches` (`source_id`);--> statement-breakpoint
CREATE INDEX `idx_fetches_status` ON `source_fetches` (`fetch_status`);--> statement-breakpoint
CREATE TABLE `sources` (
	`id` text PRIMARY KEY NOT NULL,
	`app_id` text NOT NULL,
	`source_type` text NOT NULL,
	`label` text,
	`base_url` text,
	`config_json` text,
	`parser_key` text NOT NULL,
	`channel` text,
	`poll_interval_minutes` integer DEFAULT 60 NOT NULL,
	`review_status` text DEFAULT 'pending' NOT NULL,
	`role` text,
	`discovered_via` text,
	`approved_at` text,
	`reviewed_at` text,
	`reviewed_by` text,
	`status` text DEFAULT 'disabled' NOT NULL,
	`last_success_at` text,
	`last_failure_at` text,
	`last_fetched_at` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`app_id`) REFERENCES `apps`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `idx_sources_app_id` ON `sources` (`app_id`);--> statement-breakpoint
CREATE INDEX `idx_sources_status` ON `sources` (`status`);--> statement-breakpoint
CREATE INDEX `idx_sources_type` ON `sources` (`source_type`);--> statement-breakpoint
CREATE INDEX `idx_sources_review_status` ON `sources` (`review_status`);--> statement-breakpoint
CREATE INDEX `idx_sources_role` ON `sources` (`role`);