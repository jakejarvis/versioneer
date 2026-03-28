import { sqliteTable, text, integer, index } from "drizzle-orm/sqlite-core";

export const jobFailures = sqliteTable(
  "job_failures",
  {
    id: text("id").primaryKey(),
    jobType: text("job_type").notNull(),
    jobKey: text("job_key"),
    relatedId: text("related_id"),
    errorMessage: text("error_message"),
    retryCount: integer("retry_count").notNull().default(0),
    status: text("status", { enum: ["open", "retrying", "resolved", "abandoned"] })
      .notNull()
      .default("open"),
    createdAt: text("created_at").notNull(),
    resolvedAt: text("resolved_at"),
  },
  (table) => [
    index("idx_job_failures_status").on(table.status),
    index("idx_job_failures_type").on(table.jobType),
  ],
);

export const auditLog = sqliteTable(
  "audit_log",
  {
    id: text("id").primaryKey(),
    eventType: text("event_type").notNull(),
    actorType: text("actor_type").notNull(),
    actorId: text("actor_id"),
    targetType: text("target_type"),
    targetId: text("target_id"),
    payloadJson: text("payload_json"),
    createdAt: text("created_at").notNull(),
  },
  (table) => [
    index("idx_audit_event_type").on(table.eventType),
    index("idx_audit_target").on(table.targetType, table.targetId),
  ],
);

export const cronJobRuns = sqliteTable(
  "cron_job_runs",
  {
    id: text("id").primaryKey(),
    jobType: text("job_type", {
      enum: ["poll_sources", "cask_index_sync"],
    }).notNull(),
    trigger: text("trigger", { enum: ["manual", "scheduled"] }).notNull(),
    status: text("status", {
      enum: ["running", "completed", "failed"],
    })
      .notNull()
      .default("running"),
    actorId: text("actor_id"),
    itemsQueued: integer("items_queued"),
    itemsTotal: integer("items_total"),
    resultJson: text("result_json"),
    errorMessage: text("error_message"),
    startedAt: text("started_at").notNull(),
    completedAt: text("completed_at"),
  },
  (table) => [
    index("idx_cron_job_runs_type").on(table.jobType),
    index("idx_cron_job_runs_started").on(table.startedAt),
  ],
);
