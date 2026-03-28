DROP TABLE `app_scorecards`;--> statement-breakpoint
DROP TABLE `onboarding_checklists`;--> statement-breakpoint
DROP TABLE `admin_overrides`;--> statement-breakpoint
DROP TABLE `review_queue`;--> statement-breakpoint
DROP TABLE `artifact_contents`;--> statement-breakpoint
DROP TABLE `artifact_observations`;--> statement-breakpoint
DROP TABLE `install_rules`;--> statement-breakpoint
DROP TABLE `source_health_metrics`;--> statement-breakpoint
ALTER TABLE `apps` ADD `is_verified` integer DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `apps` ADD `verified_at` text;--> statement-breakpoint
ALTER TABLE `apps` ADD `install_strategy_override` text;--> statement-breakpoint
ALTER TABLE `apps` DROP COLUMN `verification_tier`;--> statement-breakpoint
ALTER TABLE `apps` DROP COLUMN `quality_state`;--> statement-breakpoint
ALTER TABLE `apps` DROP COLUMN `quality_score`;--> statement-breakpoint
ALTER TABLE `apps` DROP COLUMN `last_reviewed_at`;--> statement-breakpoint
ALTER TABLE `update_executions` ADD `install_strategy` text;--> statement-breakpoint
ALTER TABLE `update_executions` DROP COLUMN `installability_class`;--> statement-breakpoint
ALTER TABLE `app_latest_releases` ADD `install_strategy` text;--> statement-breakpoint
ALTER TABLE `app_latest_releases` ADD `pinned_release_id` text;--> statement-breakpoint
ALTER TABLE `app_latest_releases` ADD `pinned_at` text;--> statement-breakpoint
ALTER TABLE `app_latest_releases` ADD `pinned_by` text;--> statement-breakpoint
ALTER TABLE `app_latest_releases` DROP COLUMN `decision_source`;--> statement-breakpoint
ALTER TABLE `app_latest_releases` DROP COLUMN `confidence`;--> statement-breakpoint
ALTER TABLE `app_latest_releases` DROP COLUMN `decision_explanation_json`;--> statement-breakpoint
ALTER TABLE `app_latest_releases` DROP COLUMN `installability_class`;--> statement-breakpoint
ALTER TABLE `client_feedback` DROP COLUMN `review_queue_item_id`;--> statement-breakpoint
ALTER TABLE `artifacts` DROP COLUMN `signature_status`;--> statement-breakpoint
ALTER TABLE `artifacts` DROP COLUMN `notarization_status`;--> statement-breakpoint
ALTER TABLE `artifacts` DROP COLUMN `expected_team_id`;--> statement-breakpoint
ALTER TABLE `artifacts` DROP COLUMN `observed_team_id`;--> statement-breakpoint
ALTER TABLE `artifacts` DROP COLUMN `team_id_match`;--> statement-breakpoint
ALTER TABLE `artifacts` DROP COLUMN `signature_observation_json`;--> statement-breakpoint
ALTER TABLE `artifacts` DROP COLUMN `notarization_observation_json`;--> statement-breakpoint
ALTER TABLE `artifacts` DROP COLUMN `trust_level`;