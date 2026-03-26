import { sqliteTable, text, integer, index } from "drizzle-orm/sqlite-core";

export const clients = sqliteTable(
  "clients",
  {
    id: text("id").primaryKey(),
    anonymousInstallId: text("anonymous_install_id").notNull().unique(),
    platform: text("platform").notNull().default("macos"),
    appVersion: text("app_version"),
    firstSeenAt: text("first_seen_at").notNull(),
    lastSeenAt: text("last_seen_at").notNull(),
  },
  (table) => [index("idx_clients_install_id").on(table.anonymousInstallId)],
);

export const clientInventorySnapshots = sqliteTable(
  "client_inventory_snapshots",
  {
    id: text("id").primaryKey(),
    clientId: text("client_id")
      .notNull()
      .references(() => clients.id),
    osVersion: text("os_version"),
    scanDurationMs: integer("scan_duration_ms"),
    appCount: integer("app_count").notNull().default(0),
    createdAt: text("created_at").notNull(),
  },
  (table) => [index("idx_snapshots_client_id").on(table.clientId)],
);

export const clientInventoryApps = sqliteTable(
  "client_inventory_apps",
  {
    id: text("id").primaryKey(),
    snapshotId: text("snapshot_id")
      .notNull()
      .references(() => clientInventorySnapshots.id),
    appName: text("app_name"),
    bundleId: text("bundle_id"),
    installedVersionRaw: text("installed_version_raw"),
    installedVersionNormalized: text("installed_version_normalized"),
    buildNumber: text("build_number"),
    teamId: text("team_id"),
    pathHash: text("path_hash"),
    architecture: text("architecture"),
    matchedAppId: text("matched_app_id"),
    matchMethod: text("match_method"),
    matchConfidence: integer("match_confidence"),
    decisionStatus: text("decision_status", {
      enum: ["unknown", "up_to_date", "update_available", "ambiguous", "unsupported", "ignored"],
    })
      .notNull()
      .default("unknown"),
    latestReleaseId: text("latest_release_id"),
    latestVersionNormalized: text("latest_version_normalized"),
    latestVersionRaw: text("latest_version_raw"),
    matchExplanationJson: text("match_explanation_json"),
    sparkleFeedUrl: text("sparkle_feed_url"),
    createdAt: text("created_at").notNull(),
  },
  (table) => [
    index("idx_inventory_apps_snapshot_id").on(table.snapshotId),
    index("idx_inventory_apps_matched_app").on(table.matchedAppId),
    index("idx_inventory_apps_bundle_id").on(table.bundleId),
  ],
);
