CREATE TABLE `app_scorecards` (
	`id` text PRIMARY KEY NOT NULL,
	`app_id` text NOT NULL,
	`source_types_present` text,
	`latest_fetch_success_at` text,
	`recent_fetch_success_rate` integer,
	`recent_parse_success_rate` integer,
	`latest_release_confidence` integer,
	`artifact_trust_status` text,
	`inventory_match_success_rate` integer,
	`ambiguity_rate` integer,
	`active_override_count` integer DEFAULT 0 NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`app_id`) REFERENCES `apps`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_scorecards_app_id` ON `app_scorecards` (`app_id`);--> statement-breakpoint
CREATE TABLE `onboarding_checklists` (
	`id` text PRIMARY KEY NOT NULL,
	`app_id` text NOT NULL,
	`has_canonical_record` integer DEFAULT false NOT NULL,
	`has_aliases` integer DEFAULT false NOT NULL,
	`has_source` integer DEFAULT false NOT NULL,
	`parser_output_verified` integer DEFAULT false NOT NULL,
	`latest_release_published` integer DEFAULT false NOT NULL,
	`review_queue_clear` integer DEFAULT false NOT NULL,
	`quality_score_acceptable` integer DEFAULT false NOT NULL,
	`is_complete` integer DEFAULT false NOT NULL,
	`completed_at` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`app_id`) REFERENCES `apps`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_onboarding_app_id` ON `onboarding_checklists` (`app_id`);--> statement-breakpoint
CREATE TABLE `source_health_metrics` (
	`id` text PRIMARY KEY NOT NULL,
	`source_id` text NOT NULL,
	`period_start` text NOT NULL,
	`fetch_attempts` integer DEFAULT 0 NOT NULL,
	`fetch_successes` integer DEFAULT 0 NOT NULL,
	`fetch_failures` integer DEFAULT 0 NOT NULL,
	`parse_attempts` integer DEFAULT 0 NOT NULL,
	`parse_successes` integer DEFAULT 0 NOT NULL,
	`parse_failures` integer DEFAULT 0 NOT NULL,
	`review_items_created` integer DEFAULT 0 NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`source_id`) REFERENCES `sources`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `idx_health_source_id` ON `source_health_metrics` (`source_id`);--> statement-breakpoint
CREATE INDEX `idx_health_source_period` ON `source_health_metrics` (`source_id`,`period_start`);--> statement-breakpoint
ALTER TABLE `apps` ADD `verification_tier` text DEFAULT 'unverified' NOT NULL;--> statement-breakpoint
ALTER TABLE `apps` ADD `quality_state` text DEFAULT 'unknown' NOT NULL;--> statement-breakpoint
ALTER TABLE `apps` ADD `quality_score` integer;--> statement-breakpoint
ALTER TABLE `apps` ADD `last_reviewed_at` text;--> statement-breakpoint
ALTER TABLE `client_inventory_apps` ADD `match_explanation_json` text;--> statement-breakpoint
ALTER TABLE `app_latest_releases` ADD `decision_explanation_json` text;