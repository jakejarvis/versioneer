ALTER TABLE `artifacts` ADD `canonical_url` text;--> statement-breakpoint
ALTER TABLE `artifacts` ADD `identity_key` text;--> statement-breakpoint
UPDATE `artifacts` SET `canonical_url` = `url` WHERE `canonical_url` IS NULL;--> statement-breakpoint
UPDATE `artifacts` SET `identity_key` = 'legacy:' || `id` WHERE `identity_key` IS NULL;--> statement-breakpoint
CREATE UNIQUE INDEX `idx_artifacts_release_identity_key` ON `artifacts` (`release_id`,`identity_key`);--> statement-breakpoint
PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_release_observations` (
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
	`observation_key` text NOT NULL,
	`confidence` integer,
	`observation_json` text,
	`created_at` text NOT NULL,
	`last_seen_at` text NOT NULL,
	`seen_count` integer DEFAULT 1 NOT NULL,
	FOREIGN KEY (`parser_run_id`) REFERENCES `parser_runs`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`app_id`) REFERENCES `apps`(`id`) ON UPDATE no action ON DELETE no action
);--> statement-breakpoint
INSERT INTO `__new_release_observations` (
	`id`,
	`parser_run_id`,
	`app_id`,
	`release_id`,
	`observed_version_raw`,
	`observed_version_normalized`,
	`observed_build_number`,
	`observed_channel`,
	`observed_published_at`,
	`observed_release_notes_url`,
	`observed_download_url`,
	`observation_key`,
	`confidence`,
	`observation_json`,
	`created_at`,
	`last_seen_at`,
	`seen_count`
)
SELECT
	`id`,
	`parser_run_id`,
	`app_id`,
	`release_id`,
	`observed_version_raw`,
	`observed_version_normalized`,
	`observed_build_number`,
	`observed_channel`,
	`observed_published_at`,
	`observed_release_notes_url`,
	`observed_download_url`,
	'legacy:' || `id`,
	`confidence`,
	`observation_json`,
	`created_at`,
	`created_at`,
	1
FROM `release_observations`;--> statement-breakpoint
DROP TABLE `release_observations`;--> statement-breakpoint
ALTER TABLE `__new_release_observations` RENAME TO `release_observations`;--> statement-breakpoint
CREATE INDEX `idx_observations_parser_run` ON `release_observations` (`parser_run_id`);--> statement-breakpoint
CREATE INDEX `idx_observations_app_id` ON `release_observations` (`app_id`);--> statement-breakpoint
CREATE INDEX `idx_observations_release_id` ON `release_observations` (`release_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `idx_observations_release_observation_key` ON `release_observations` (`release_id`,`observation_key`);--> statement-breakpoint
PRAGMA foreign_keys=ON;
