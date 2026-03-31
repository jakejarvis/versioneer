import {
  discoveredAppStatusValues,
  enrichmentStatusValues,
  sourceValidationStatusValues,
} from "@versioneer/schemas/discovery";
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
    status: text("status", { enum: discoveredAppStatusValues }).notNull().default("pending"),
    linkedAppId: text("linked_app_id").references(() => apps.id),
    dismissedAt: text("dismissed_at"),
    dismissedBy: text("dismissed_by"),
    sampleVersions: text("sample_versions"),
    sparkleFeedUrl: text("sparkle_feed_url"),
    sparklePublicKey: text("sparkle_public_key"),
    isSparkleApp: integer("is_sparkle_app", { mode: "boolean" }),
    isMasApp: integer("is_mas_app", { mode: "boolean" }),
    masAppId: text("mas_app_id"),
    isElectronApp: integer("is_electron_app", { mode: "boolean" }),
    electronUpdateProvider: text("electron_update_provider"),
    electronUpdateUrl: text("electron_update_url"),

    // Client-reported metadata
    codeSigningAuthority: text("code_signing_authority"),
    appCategory: text("app_category"),
    minMacOSVersion: text("min_macos_version"),

    // Homebrew Cask metadata (populated by index sync)
    homebrewCaskToken: text("homebrew_cask_token"),
    homebrewCaskVersion: text("homebrew_cask_version"),
    homebrewCaskAppcastUrl: text("homebrew_cask_appcast_url"),
    homebrewCaskHomepage: text("homebrew_cask_homepage"),
    homebrewCaskMatchedAt: text("homebrew_cask_matched_at"),

    // Enrichment fields
    enrichmentStatus: text("enrichment_status", { enum: enrichmentStatusValues })
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
    sourceValidationStatus: text("source_validation_status", { enum: sourceValidationStatusValues })
      .notNull()
      .default("untested"),
    latestReasonCode: text("latest_reason_code"),
    primarySuggestionId: text("primary_suggestion_id"),
    confidenceScore: integer("confidence_score"),
    iconR2Key: text("icon_r2_key"),

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
