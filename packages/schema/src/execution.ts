import { sqliteTable, text, integer, index } from "drizzle-orm/sqlite-core";

import { apps } from "./catalog";
import { clients } from "./clients";
import { releases } from "./releases";

export const updateExecutions = sqliteTable(
  "update_executions",
  {
    id: text("id").primaryKey(),
    clientId: text("client_id")
      .notNull()
      .references(() => clients.id),
    appId: text("app_id")
      .notNull()
      .references(() => apps.id),
    releaseId: text("release_id")
      .notNull()
      .references(() => releases.id),
    artifactId: text("artifact_id"),
    actionType: text("action_type", {
      enum: [
        "view_notes",
        "download",
        "assisted_replace",
        "sparkle",
        "pkg_install",
        "automation",
        "homebrew_upgrade",
      ],
    }).notNull(),
    actionStatus: text("action_status", {
      enum: ["initiated", "in_progress", "completed", "failed", "cancelled"],
    }).notNull(),
    clientVersionBefore: text("client_version_before"),
    clientVersionAfter: text("client_version_after"),
    installStrategy: text("install_strategy"),
    errorMessage: text("error_message"),
    detailsJson: text("details_json"),
    durationMs: integer("duration_ms"),
    initiatedAt: text("initiated_at").notNull(),
    completedAt: text("completed_at"),
  },
  (table) => [
    index("idx_exec_client_id").on(table.clientId),
    index("idx_exec_app_id").on(table.appId),
    index("idx_exec_status").on(table.actionStatus),
  ],
);
