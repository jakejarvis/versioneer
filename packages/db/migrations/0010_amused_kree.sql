PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_artifacts` (
	`id` text PRIMARY KEY NOT NULL,
	`release_id` text NOT NULL,
	`artifact_type` text NOT NULL,
	`url` text NOT NULL,
	`canonical_url` text NOT NULL,
	`identity_key` text NOT NULL,
	`sha256` text,
	`size_bytes` integer,
	`architecture` text DEFAULT 'unknown' NOT NULL,
	`min_os_version` text,
	`is_primary` integer DEFAULT false NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`release_id`) REFERENCES `releases`(`id`) ON UPDATE no action ON DELETE no action
);--> statement-breakpoint
INSERT INTO `__new_artifacts` (
	`id`,
	`release_id`,
	`artifact_type`,
	`url`,
	`canonical_url`,
	`identity_key`,
	`sha256`,
	`size_bytes`,
	`architecture`,
	`min_os_version`,
	`is_primary`,
	`created_at`
)
SELECT
	`id`,
	`release_id`,
	`artifact_type`,
	`url`,
	coalesce(`canonical_url`, `url`),
	coalesce(`identity_key`, 'legacy:' || `id`),
	`sha256`,
	`size_bytes`,
	coalesce(`architecture`, 'unknown'),
	`min_os_version`,
	coalesce(`is_primary`, 0),
	`created_at`
FROM `artifacts`;--> statement-breakpoint
DROP TABLE `artifacts`;--> statement-breakpoint
ALTER TABLE `__new_artifacts` RENAME TO `artifacts`;--> statement-breakpoint
CREATE INDEX `idx_artifacts_release_id` ON `artifacts` (`release_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `idx_artifacts_release_identity_key` ON `artifacts` (`release_id`,`identity_key`);--> statement-breakpoint
PRAGMA foreign_keys=ON;
