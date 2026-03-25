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
CREATE TABLE `app_match_rules` (
	`id` text PRIMARY KEY NOT NULL,
	`app_id` text NOT NULL,
	`rule_type` text NOT NULL,
	`rule_json` text NOT NULL,
	`priority` integer DEFAULT 0 NOT NULL,
	`enabled` integer DEFAULT true NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`app_id`) REFERENCES `apps`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `idx_match_rules_app_id` ON `app_match_rules` (`app_id`);--> statement-breakpoint
CREATE TABLE `apps` (
	`id` text PRIMARY KEY NOT NULL,
	`slug` text NOT NULL,
	`canonical_name` text NOT NULL,
	`vendor_name` text,
	`homepage_url` text,
	`status` text DEFAULT 'active' NOT NULL,
	`merged_into_app_id` text,
	`notes` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `apps_slug_unique` ON `apps` (`slug`);--> statement-breakpoint
CREATE INDEX `idx_apps_slug` ON `apps` (`slug`);--> statement-breakpoint
CREATE INDEX `idx_apps_status` ON `apps` (`status`);--> statement-breakpoint
CREATE TABLE `client_inventory_apps` (
	`id` text PRIMARY KEY NOT NULL,
	`snapshot_id` text NOT NULL,
	`app_name` text,
	`bundle_id` text,
	`installed_version_raw` text,
	`installed_version_normalized` text,
	`build_number` text,
	`team_id` text,
	`path_hash` text,
	`architecture` text,
	`matched_app_id` text,
	`match_method` text,
	`match_confidence` integer,
	`decision_status` text DEFAULT 'unknown' NOT NULL,
	`latest_release_id` text,
	`latest_version_normalized` text,
	`latest_version_raw` text,
	`created_at` text NOT NULL,
	FOREIGN KEY (`snapshot_id`) REFERENCES `client_inventory_snapshots`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `idx_inventory_apps_snapshot_id` ON `client_inventory_apps` (`snapshot_id`);--> statement-breakpoint
CREATE INDEX `idx_inventory_apps_matched_app` ON `client_inventory_apps` (`matched_app_id`);--> statement-breakpoint
CREATE INDEX `idx_inventory_apps_bundle_id` ON `client_inventory_apps` (`bundle_id`);--> statement-breakpoint
CREATE TABLE `client_inventory_snapshots` (
	`id` text PRIMARY KEY NOT NULL,
	`client_id` text NOT NULL,
	`os_version` text,
	`scan_duration_ms` integer,
	`app_count` integer DEFAULT 0 NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`client_id`) REFERENCES `clients`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `idx_snapshots_client_id` ON `client_inventory_snapshots` (`client_id`);--> statement-breakpoint
CREATE TABLE `clients` (
	`id` text PRIMARY KEY NOT NULL,
	`anonymous_install_id` text NOT NULL,
	`platform` text DEFAULT 'macos' NOT NULL,
	`app_version` text,
	`first_seen_at` text NOT NULL,
	`last_seen_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `clients_anonymous_install_id_unique` ON `clients` (`anonymous_install_id`);--> statement-breakpoint
CREATE INDEX `idx_clients_install_id` ON `clients` (`anonymous_install_id`);--> statement-breakpoint
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
	`poll_interval_minutes` integer DEFAULT 60 NOT NULL,
	`status` text DEFAULT 'active' NOT NULL,
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
CREATE TABLE `app_latest_releases` (
	`id` text PRIMARY KEY NOT NULL,
	`app_id` text NOT NULL,
	`channel` text DEFAULT 'stable' NOT NULL,
	`release_id` text NOT NULL,
	`artifact_id` text,
	`version_normalized` text NOT NULL,
	`version_raw` text NOT NULL,
	`released_at` text,
	`decision_source` text DEFAULT 'pipeline' NOT NULL,
	`confidence` integer,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`app_id`) REFERENCES `apps`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`release_id`) REFERENCES `releases`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_latest_app_channel` ON `app_latest_releases` (`app_id`,`channel`);--> statement-breakpoint
CREATE TABLE `artifact_contents` (
	`id` text PRIMARY KEY NOT NULL,
	`artifact_id` text NOT NULL,
	`content_type` text,
	`path_within_artifact` text,
	`bundle_id` text,
	`app_name` text,
	`version_raw` text,
	`version_normalized` text,
	`team_id` text,
	`executable_sha256` text,
	`created_at` text NOT NULL,
	FOREIGN KEY (`artifact_id`) REFERENCES `artifacts`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `idx_artifact_contents_artifact_id` ON `artifact_contents` (`artifact_id`);--> statement-breakpoint
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
	`signature_status` text DEFAULT 'unknown',
	`notarization_status` text DEFAULT 'unknown',
	`expected_team_id` text,
	`is_primary` integer DEFAULT false NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`release_id`) REFERENCES `releases`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `idx_artifacts_release_id` ON `artifacts` (`release_id`);--> statement-breakpoint
CREATE TABLE `install_rules` (
	`id` text PRIMARY KEY NOT NULL,
	`app_id` text NOT NULL,
	`strategy` text NOT NULL,
	`requires_quit` integer DEFAULT true NOT NULL,
	`requires_admin` integer DEFAULT false NOT NULL,
	`supports_silent` integer DEFAULT false NOT NULL,
	`rollback_supported` integer DEFAULT false NOT NULL,
	`rule_confidence` integer,
	`enabled` integer DEFAULT true NOT NULL,
	`notes` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`app_id`) REFERENCES `apps`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `idx_install_rules_app_id` ON `install_rules` (`app_id`);--> statement-breakpoint
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
	`status` text DEFAULT 'active' NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`app_id`) REFERENCES `apps`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `idx_releases_app_id` ON `releases` (`app_id`);--> statement-breakpoint
CREATE INDEX `idx_releases_app_channel` ON `releases` (`app_id`,`channel`);--> statement-breakpoint
CREATE INDEX `idx_releases_version` ON `releases` (`app_id`,`version_normalized`);--> statement-breakpoint
CREATE INDEX `idx_releases_status` ON `releases` (`status`);--> statement-breakpoint
CREATE TABLE `admin_overrides` (
	`id` text PRIMARY KEY NOT NULL,
	`override_type` text NOT NULL,
	`target_type` text NOT NULL,
	`target_id` text NOT NULL,
	`payload_json` text NOT NULL,
	`reason` text,
	`created_by` text,
	`is_active` integer DEFAULT true NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_overrides_target` ON `admin_overrides` (`target_type`,`target_id`);--> statement-breakpoint
CREATE INDEX `idx_overrides_active` ON `admin_overrides` (`is_active`);--> statement-breakpoint
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
CREATE TABLE `review_queue` (
	`id` text PRIMARY KEY NOT NULL,
	`review_type` text NOT NULL,
	`related_id` text,
	`payload_json` text,
	`priority` integer DEFAULT 0 NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`created_at` text NOT NULL,
	`resolved_at` text
);
--> statement-breakpoint
CREATE INDEX `idx_review_queue_status` ON `review_queue` (`status`);--> statement-breakpoint
CREATE INDEX `idx_review_queue_priority` ON `review_queue` (`priority`);