CREATE TABLE `inventory_icon_upload_requests` (
	`id` text PRIMARY KEY NOT NULL,
	`submission_id` text NOT NULL,
	`kind` text NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`lookup_key` text NOT NULL,
	`app_name` text NOT NULL,
	`bundle_id` text,
	`app_id` text,
	`team_id` text,
	`version` text,
	`sparkle_feed_url` text,
	`sparkle_public_key` text,
	`is_sparkle_app` integer,
	`is_mas_app` integer,
	`mas_app_id` text,
	`is_electron_app` integer,
	`electron_update_provider` text,
	`electron_update_url` text,
	`code_signing_authority` text,
	`app_category` text,
	`min_macos_version` text,
	`homebrew_cask_token` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`expires_at` text NOT NULL,
	`received_at` text,
	`error_message` text,
	FOREIGN KEY (`app_id`) REFERENCES `apps`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `idx_inventory_icon_upload_submission` ON `inventory_icon_upload_requests` (`submission_id`);--> statement-breakpoint
CREATE INDEX `idx_inventory_icon_upload_status_expires` ON `inventory_icon_upload_requests` (`status`,`expires_at`);--> statement-breakpoint
CREATE INDEX `idx_inventory_icon_upload_app` ON `inventory_icon_upload_requests` (`app_id`);--> statement-breakpoint
CREATE INDEX `idx_inventory_icon_upload_lookup` ON `inventory_icon_upload_requests` (`lookup_key`);