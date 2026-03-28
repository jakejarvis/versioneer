CREATE TABLE `cron_job_runs` (
	`id` text PRIMARY KEY NOT NULL,
	`job_type` text NOT NULL,
	`trigger` text NOT NULL,
	`status` text DEFAULT 'running' NOT NULL,
	`actor_id` text,
	`items_queued` integer,
	`items_total` integer,
	`result_json` text,
	`error_message` text,
	`started_at` text NOT NULL,
	`completed_at` text
);
--> statement-breakpoint
CREATE INDEX `idx_cron_job_runs_type` ON `cron_job_runs` (`job_type`);--> statement-breakpoint
CREATE INDEX `idx_cron_job_runs_started` ON `cron_job_runs` (`started_at`);