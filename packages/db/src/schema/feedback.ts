import { sqliteTable, text, index } from "drizzle-orm/sqlite-core";

import { feedbackStatusValues, feedbackTypeValues } from "@versioneer/schemas/feedback";

export const clientFeedback = sqliteTable(
  "client_feedback",
  {
    id: text("id").primaryKey(),
    feedbackType: text("feedback_type", { enum: feedbackTypeValues }).notNull(),
    targetAppId: text("target_app_id"),
    bundleId: text("bundle_id"),
    appName: text("app_name"),
    payloadJson: text("payload_json"),
    status: text("status", { enum: feedbackStatusValues }).notNull().default("new"),
    resolvedAt: text("resolved_at"),
    createdAt: text("created_at").notNull(),
  },
  (table) => [
    index("idx_feedback_status").on(table.status),
    index("idx_feedback_type").on(table.feedbackType),
    index("idx_feedback_target_app").on(table.targetAppId),
    index("idx_feedback_status_created").on(table.status, table.createdAt),
    index("idx_feedback_type_created").on(table.feedbackType, table.createdAt),
  ],
);
