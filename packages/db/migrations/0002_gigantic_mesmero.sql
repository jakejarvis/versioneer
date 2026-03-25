CREATE TABLE `client_feedback` (
	`id` text PRIMARY KEY NOT NULL,
	`client_id` text NOT NULL,
	`snapshot_id` text,
	`inventory_app_id` text,
	`feedback_type` text NOT NULL,
	`target_app_id` text,
	`bundle_id` text,
	`app_name` text,
	`payload_json` text,
	`status` text DEFAULT 'new' NOT NULL,
	`review_queue_item_id` text,
	`resolved_at` text,
	`created_at` text NOT NULL,
	FOREIGN KEY (`client_id`) REFERENCES `clients`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`snapshot_id`) REFERENCES `client_inventory_snapshots`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`inventory_app_id`) REFERENCES `client_inventory_apps`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `idx_feedback_client_id` ON `client_feedback` (`client_id`);--> statement-breakpoint
CREATE INDEX `idx_feedback_status` ON `client_feedback` (`status`);--> statement-breakpoint
CREATE INDEX `idx_feedback_type` ON `client_feedback` (`feedback_type`);--> statement-breakpoint
CREATE INDEX `idx_feedback_target_app` ON `client_feedback` (`target_app_id`);