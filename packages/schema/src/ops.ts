import { sqliteTable, text, integer, index } from "drizzle-orm/sqlite-core";

export const adminOverrides = sqliteTable("admin_overrides", {
  id: text("id").primaryKey(),
  overrideType: text("override_type").notNull(),
  targetType: text("target_type").notNull(),
  targetId: text("target_id").notNull(),
  payloadJson: text("payload_json").notNull(),
  reason: text("reason"),
  createdBy: text("created_by"),
  isActive: integer("is_active", { mode: "boolean" }).notNull().default(true),
  createdAt: text("created_at").notNull(),
}, (table) => [
  index("idx_overrides_target").on(table.targetType, table.targetId),
  index("idx_overrides_active").on(table.isActive),
]);

export const jobFailures = sqliteTable("job_failures", {
  id: text("id").primaryKey(),
  jobType: text("job_type").notNull(),
  jobKey: text("job_key"),
  relatedId: text("related_id"),
  errorMessage: text("error_message"),
  retryCount: integer("retry_count").notNull().default(0),
  status: text("status", { enum: ["open", "retrying", "resolved", "abandoned"] }).notNull().default("open"),
  createdAt: text("created_at").notNull(),
  resolvedAt: text("resolved_at"),
}, (table) => [
  index("idx_job_failures_status").on(table.status),
  index("idx_job_failures_type").on(table.jobType),
]);

export const reviewQueue = sqliteTable("review_queue", {
  id: text("id").primaryKey(),
  reviewType: text("review_type").notNull(),
  relatedId: text("related_id"),
  payloadJson: text("payload_json"),
  priority: integer("priority").notNull().default(0),
  status: text("status", { enum: ["pending", "in_progress", "resolved", "dismissed"] }).notNull().default("pending"),
  createdAt: text("created_at").notNull(),
  resolvedAt: text("resolved_at"),
}, (table) => [
  index("idx_review_queue_status").on(table.status),
  index("idx_review_queue_priority").on(table.priority),
]);

export const auditLog = sqliteTable("audit_log", {
  id: text("id").primaryKey(),
  eventType: text("event_type").notNull(),
  actorType: text("actor_type").notNull(),
  actorId: text("actor_id"),
  targetType: text("target_type"),
  targetId: text("target_id"),
  payloadJson: text("payload_json"),
  createdAt: text("created_at").notNull(),
}, (table) => [
  index("idx_audit_event_type").on(table.eventType),
  index("idx_audit_target").on(table.targetType, table.targetId),
]);
