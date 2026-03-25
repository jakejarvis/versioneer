CREATE TABLE `update_executions` (
	`id` text PRIMARY KEY NOT NULL,
	`client_id` text NOT NULL,
	`app_id` text NOT NULL,
	`release_id` text NOT NULL,
	`artifact_id` text,
	`action_type` text NOT NULL,
	`action_status` text NOT NULL,
	`client_version_before` text,
	`client_version_after` text,
	`installability_class` text,
	`error_message` text,
	`duration_ms` integer,
	`initiated_at` text NOT NULL,
	`completed_at` text,
	FOREIGN KEY (`client_id`) REFERENCES `clients`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`app_id`) REFERENCES `apps`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`release_id`) REFERENCES `releases`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `idx_exec_client_id` ON `update_executions` (`client_id`);--> statement-breakpoint
CREATE INDEX `idx_exec_app_id` ON `update_executions` (`app_id`);--> statement-breakpoint
CREATE INDEX `idx_exec_status` ON `update_executions` (`action_status`);--> statement-breakpoint
CREATE TABLE `artifact_observations` (
	`id` text PRIMARY KEY NOT NULL,
	`artifact_id` text NOT NULL,
	`observation_type` text NOT NULL,
	`status` text NOT NULL,
	`observed_value` text,
	`expected_value` text,
	`detail_json` text,
	`observed_at` text NOT NULL,
	FOREIGN KEY (`artifact_id`) REFERENCES `artifacts`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `idx_artifact_obs_artifact_id` ON `artifact_observations` (`artifact_id`);--> statement-breakpoint
ALTER TABLE `app_latest_releases` ADD `installability_class` text DEFAULT 'notify_only';--> statement-breakpoint
ALTER TABLE `artifacts` ADD `observed_team_id` text;--> statement-breakpoint
ALTER TABLE `artifacts` ADD `team_id_match` text DEFAULT 'unknown';--> statement-breakpoint
ALTER TABLE `artifacts` ADD `signature_observation_json` text;--> statement-breakpoint
ALTER TABLE `artifacts` ADD `notarization_observation_json` text;--> statement-breakpoint
ALTER TABLE `artifacts` ADD `trust_level` text DEFAULT 'unknown';