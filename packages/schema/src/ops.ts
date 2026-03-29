import { sqliteTable, text, integer, index } from "drizzle-orm/sqlite-core";

import { apps } from "./catalog";
import { releases } from "./releases";

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

export const installExecutions = sqliteTable(
  "install_executions",
  {
    id: text("id").primaryKey(),
    appId: text("app_id")
      .notNull()
      .references(() => apps.id),
    releaseId: text("release_id")
      .notNull()
      .references(() => releases.id),
    artifactId: text("artifact_id"),
    clientPlatform: text("client_platform").notNull(),
    clientAppVersion: text("client_app_version"),
    clientOsVersion: text("client_os_version"),
    clientSystemArchitecture: text("client_system_architecture"),
    channel: text("channel"),
    installStrategy: text("install_strategy", {
      enum: [
        "sparkle",
        "zip_replace",
        "dmg_copy_replace",
        "pkg_install",
        "mac_app_store",
        "manual_only",
      ],
    }).notNull(),
    executionRoute: text("execution_route", {
      enum: ["sparkle", "local_replace", "privileged_replace", "privileged_package"],
    }),
    status: text("status", {
      enum: ["prepared", "started", "succeeded", "failed", "cancelled"],
    })
      .notNull()
      .default("prepared"),
    expectedBundleId: text("expected_bundle_id"),
    expectedTeamId: text("expected_team_id"),
    previousVersion: text("previous_version"),
    installedVersion: text("installed_version"),
    errorMessage: text("error_message"),
    verificationJson: text("verification_json"),
    preparedAt: text("prepared_at").notNull(),
    completedAt: text("completed_at"),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [
    index("idx_install_executions_app_id").on(table.appId),
    index("idx_install_executions_release_id").on(table.releaseId),
    index("idx_install_executions_status").on(table.status),
    index("idx_install_executions_completed_at").on(table.completedAt),
  ],
);
