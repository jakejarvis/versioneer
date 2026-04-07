CREATE TABLE `device_attestations` (
	`id` text PRIMARY KEY NOT NULL,
	`key_id` text NOT NULL,
	`public_key` text NOT NULL,
	`counter` integer DEFAULT 0 NOT NULL,
	`receipt` text,
	`environment` text,
	`created_at` text NOT NULL,
	`last_used_at` text
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_device_attestations_key_id` ON `device_attestations` (`key_id`);