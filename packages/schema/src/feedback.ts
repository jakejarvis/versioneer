import { sqliteTable, text, index } from "drizzle-orm/sqlite-core";

import { clients, clientInventorySnapshots, clientInventoryApps } from "./clients";

export const clientFeedback = sqliteTable(
  "client_feedback",
  {
    id: text("id").primaryKey(),
    clientId: text("client_id")
      .notNull()
      .references(() => clients.id),
    snapshotId: text("snapshot_id").references(() => clientInventorySnapshots.id),
    inventoryAppId: text("inventory_app_id").references(() => clientInventoryApps.id),
    feedbackType: text("feedback_type", {
      enum: ["wrong_match", "wrong_version", "app_request", "general"],
    }).notNull(),
    targetAppId: text("target_app_id"),
    bundleId: text("bundle_id"),
    appName: text("app_name"),
    payloadJson: text("payload_json"),
    status: text("status", {
      enum: ["new", "triaged", "resolved", "dismissed"],
    })
      .notNull()
      .default("new"),
    resolvedAt: text("resolved_at"),
    createdAt: text("created_at").notNull(),
  },
  (table) => [
    index("idx_feedback_client_id").on(table.clientId),
    index("idx_feedback_status").on(table.status),
    index("idx_feedback_type").on(table.feedbackType),
    index("idx_feedback_target_app").on(table.targetAppId),
  ],
);
