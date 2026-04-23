ALTER TABLE `catalog_suggestions` ADD `processing_started_at` text;--> statement-breakpoint
ALTER TABLE `catalog_suggestions` ADD `processing_by` text;--> statement-breakpoint
ALTER TABLE `catalog_suggestions` ADD `last_error` text;--> statement-breakpoint
ALTER TABLE `catalog_suggestions` ADD `approval_attempt_count` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `trust_assertions` ADD `dedupe_key` text;--> statement-breakpoint
UPDATE `trust_assertions`
SET `dedupe_key` = 'trust:' || COALESCE(`app_id`, 'none') || ':' || COALESCE(`source_id`, 'none') || ':' || `assertion_type` || ':' || `value`
WHERE `dedupe_key` IS NULL;--> statement-breakpoint
DELETE FROM `trust_assertions`
WHERE `rowid` NOT IN (
  SELECT MIN(`rowid`)
  FROM `trust_assertions`
  GROUP BY `dedupe_key`
);--> statement-breakpoint
CREATE UNIQUE INDEX `idx_trust_assertions_dedupe_key` ON `trust_assertions` (`dedupe_key`);
