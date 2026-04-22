CREATE TABLE `inventory_followup_jobs` (
	`id` text PRIMARY KEY NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`payload_r2_key` text NOT NULL,
	`workflow_instance_id` text,
	`attempt_count` integer DEFAULT 0 NOT NULL,
	`items_total` integer,
	`items_succeeded` integer,
	`items_failed` integer,
	`error_message` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`queued_at` text,
	`started_at` text,
	`completed_at` text
);
--> statement-breakpoint
CREATE INDEX `idx_inventory_followup_jobs_status` ON `inventory_followup_jobs` (`status`);--> statement-breakpoint
CREATE INDEX `idx_inventory_followup_jobs_status_updated` ON `inventory_followup_jobs` (`status`,`updated_at`);--> statement-breakpoint
CREATE INDEX `idx_inventory_followup_jobs_created` ON `inventory_followup_jobs` (`created_at`);