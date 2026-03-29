DROP TABLE `client_inventory_apps`;--> statement-breakpoint
DROP TABLE `client_inventory_snapshots`;--> statement-breakpoint
DROP TABLE `clients`;--> statement-breakpoint
DROP TABLE `update_executions`;--> statement-breakpoint
PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_client_feedback` (
	`id` text PRIMARY KEY NOT NULL,
	`feedback_type` text NOT NULL,
	`target_app_id` text,
	`bundle_id` text,
	`app_name` text,
	`payload_json` text,
	`status` text DEFAULT 'new' NOT NULL,
	`resolved_at` text,
	`created_at` text NOT NULL
);
--> statement-breakpoint
INSERT INTO `__new_client_feedback`("id", "feedback_type", "target_app_id", "bundle_id", "app_name", "payload_json", "status", "resolved_at", "created_at") SELECT "id", "feedback_type", "target_app_id", "bundle_id", "app_name", "payload_json", "status", "resolved_at", "created_at" FROM `client_feedback`;--> statement-breakpoint
DROP TABLE `client_feedback`;--> statement-breakpoint
ALTER TABLE `__new_client_feedback` RENAME TO `client_feedback`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE INDEX `idx_feedback_status` ON `client_feedback` (`status`);--> statement-breakpoint
CREATE INDEX `idx_feedback_type` ON `client_feedback` (`feedback_type`);--> statement-breakpoint
CREATE INDEX `idx_feedback_target_app` ON `client_feedback` (`target_app_id`);