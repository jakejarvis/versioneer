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
    status: text("status", { enum: ["pending", "approved", "dismissed", "mas_app"] })
      .notNull()
      .default("pending"),
    onboardedAppId: text("onboarded_app_id").references(() => apps.id),
    dismissedAt: text("dismissed_at"),
    dismissedBy: text("dismissed_by"),
    sampleVersions: text("sample_versions"),
    sparkleFeedUrl: text("sparkle_feed_url"),
    isMasApp: integer("is_mas_app", { mode: "boolean" }),
    electronUpdateUrl: text("electron_update_url"),

    // Client-reported metadata
    codeSigningAuthority: text("code_signing_authority"),
    appCategory: text("app_category"),
    minMacOSVersion: text("min_macos_version"),

    // Enrichment fields
    enrichmentStatus: text("enrichment_status", {
      enum: ["pending", "in_progress", "success", "failed", "skipped"],
    })
      .notNull()
      .default("pending"),
    enrichedAt: text("enriched_at"),
    enrichmentError: text("enrichment_error"),
    enrichedVendorName: text("enriched_vendor_name"),
    enrichedHomepageUrl: text("enriched_homepage_url"),
    enrichedLatestVersion: text("enriched_latest_version"),
    enrichedLatestPublishedAt: text("enriched_latest_published_at"),
    enrichedReleaseCount: integer("enriched_release_count"),
    enrichedFeedTitle: text("enriched_feed_title"),
    enrichedMetadataJson: text("enriched_metadata_json"),
    sourceValidationStatus: text("source_validation_status", {
      enum: ["untested", "valid", "invalid", "timeout"],
    })
      .notNull()
      .default("untested"),
    confidenceScore: integer("confidence_score"),

    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [
    uniqueIndex("idx_discovered_apps_lookup_key").on(table.lookupKey),
    index("idx_discovered_apps_status").on(table.status),
    index("idx_discovered_apps_sighting_count").on(table.sightingCount),
    index("idx_discovered_apps_enrichment_status").on(table.enrichmentStatus),
    index("idx_discovered_apps_confidence_score").on(table.confidenceScore),
  ],
);
