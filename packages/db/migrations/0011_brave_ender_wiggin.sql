ALTER TABLE `inventory_followup_jobs` RENAME TO `inventory_ingestion_jobs`;--> statement-breakpoint
DROP INDEX `idx_inventory_followup_jobs_status`;--> statement-breakpoint
DROP INDEX `idx_inventory_followup_jobs_status_updated`;--> statement-breakpoint
DROP INDEX `idx_inventory_followup_jobs_created`;--> statement-breakpoint
CREATE INDEX `idx_inventory_ingestion_jobs_status` ON `inventory_ingestion_jobs` (`status`);--> statement-breakpoint
CREATE INDEX `idx_inventory_ingestion_jobs_status_updated` ON `inventory_ingestion_jobs` (`status`,`updated_at`);--> statement-breakpoint
CREATE INDEX `idx_inventory_ingestion_jobs_created` ON `inventory_ingestion_jobs` (`created_at`);