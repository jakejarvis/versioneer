import { sqliteTable, text, integer, index, uniqueIndex } from "drizzle-orm/sqlite-core";

import { apps } from "./catalog";

export const discoveredApps = sqliteTable(
  "discovered_apps",
  {
    id: text("id").primaryKey(),
    lookupKey: text("lookup_key").notNull().unique(),
    appName: text("app_name").notNull(),
    bundleId: text("bundle_id"),
    teamId: text("team_id"),
    sightingCount: integer("sighting_count").notNull().default(1),
    firstSeenAt: text("first_seen_at").notNull(),
    lastSeenAt: text("last_seen_at").notNull(),
    status: text("status", { enum: ["pending", "approved", "dismissed"] })
      .notNull()
      .default("pending"),
    onboardedAppId: text("onboarded_app_id").references(() => apps.id),
    dismissedAt: text("dismissed_at"),
    dismissedBy: text("dismissed_by"),
    sampleVersions: text("sample_versions"),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [
    uniqueIndex("idx_discovered_apps_lookup_key").on(table.lookupKey),
    index("idx_discovered_apps_status").on(table.status),
    index("idx_discovered_apps_sighting_count").on(table.sightingCount),
  ],
);
