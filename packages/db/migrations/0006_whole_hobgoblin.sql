DROP INDEX `idx_latest_app_channel`;--> statement-breakpoint
PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_app_latest_releases` (
	`id` text PRIMARY KEY NOT NULL,
	`app_id` text NOT NULL,
	`channel` text DEFAULT 'stable' NOT NULL,
	`target_architecture` text NOT NULL,
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
INSERT INTO `__new_app_latest_releases`("id", "app_id", "channel", "target_architecture", "release_id", "authority_source_id", "artifact_id", "version_normalized", "version_raw", "released_at", "install_strategy", "pinned_release_id", "pinned_at", "pinned_by", "updated_at") SELECT "id", "app_id", "channel", 'arm64', "release_id", "authority_source_id", "artifact_id", "version_normalized", "version_raw", "released_at", "install_strategy", "pinned_release_id", "pinned_at", "pinned_by", "updated_at" FROM `app_latest_releases`;--> statement-breakpoint
DROP TABLE `app_latest_releases`;--> statement-breakpoint
ALTER TABLE `__new_app_latest_releases` RENAME TO `app_latest_releases`;--> statement-breakpoint
CREATE TABLE `__new_artifacts` (
	`id` text PRIMARY KEY NOT NULL,
	`release_id` text NOT NULL,
	`artifact_type` text NOT NULL,
	`url` text NOT NULL,
	`url_hash` text,
	`sha256` text,
	`size_bytes` integer,
	`architecture` text DEFAULT 'unknown' NOT NULL,
	`min_os_version` text,
	`is_primary` integer DEFAULT false NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`release_id`) REFERENCES `releases`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
INSERT INTO `__new_artifacts`("id", "release_id", "artifact_type", "url", "url_hash", "sha256", "size_bytes", "architecture", "min_os_version", "is_primary", "created_at") SELECT "id", "release_id", "artifact_type", "url", "url_hash", "sha256", "size_bytes", coalesce("architecture", 'unknown'), "min_os_version", "is_primary", "created_at" FROM `artifacts`;--> statement-breakpoint
DROP TABLE `artifacts`;--> statement-breakpoint
ALTER TABLE `__new_artifacts` RENAME TO `artifacts`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE UNIQUE INDEX `idx_latest_app_channel_arch` ON `app_latest_releases` (`app_id`,`channel`,`target_architecture`);--> statement-breakpoint
CREATE INDEX `idx_latest_release_id` ON `app_latest_releases` (`release_id`);--> statement-breakpoint
CREATE INDEX `idx_latest_channel_released` ON `app_latest_releases` (`channel`,`released_at`);--> statement-breakpoint
CREATE INDEX `idx_artifacts_release_id` ON `artifacts` (`release_id`);--> statement-breakpoint
CREATE INDEX `idx_releases_app_channel_status_version` ON `releases` (`app_id`,`channel`,`status`,`version_normalized`);--> statement-breakpoint
ALTER TABLE `install_executions` ADD `target_architecture` text;
