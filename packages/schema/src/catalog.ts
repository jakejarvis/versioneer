import { sqliteTable, text, integer, index, uniqueIndex } from "drizzle-orm/sqlite-core";

export const apps = sqliteTable(
  "apps",
  {
    id: text("id").primaryKey(),
    slug: text("slug").notNull().unique(),
    canonicalName: text("canonical_name").notNull(),
    vendorName: text("vendor_name"),
    homepageUrl: text("homepage_url"),
    status: text("status", { enum: ["active", "deprecated", "merged", "unlisted"] })
      .notNull()
      .default("active"),
    mergedIntoAppId: text("merged_into_app_id"),
    notes: text("notes"),
    verificationTier: text("verification_tier", {
      enum: ["unverified", "provisional", "verified"],
    })
      .notNull()
      .default("unverified"),
    qualityState: text("quality_state", {
      enum: ["green", "yellow", "red", "unknown"],
    })
      .notNull()
      .default("unknown"),
    qualityScore: integer("quality_score"),
    iconR2Key: text("icon_r2_key"),
    lastReviewedAt: text("last_reviewed_at"),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [index("idx_apps_slug").on(table.slug), index("idx_apps_status").on(table.status)],
);

export const appAliases = sqliteTable(
  "app_aliases",
  {
    id: text("id").primaryKey(),
    appId: text("app_id")
      .notNull()
      .references(() => apps.id),
    aliasType: text("alias_type", {
      enum: [
        "bundle_id",
        "name",
        "team_id",
        "sparkle_feed",
        "homepage",
        "download_pattern",
        "github_repo",
        "mas_app_id",
      ],
    }).notNull(),
    value: text("value").notNull(),
    normalizedValue: text("normalized_value").notNull(),
    isExact: integer("is_exact", { mode: "boolean" }).notNull().default(true),
    priority: integer("priority").notNull().default(0),
    confidenceWeight: integer("confidence_weight").notNull().default(100),
    source: text("source"),
    isActive: integer("is_active", { mode: "boolean" }).notNull().default(true),
    createdAt: text("created_at").notNull(),
  },
  (table) => [
    index("idx_aliases_app_id").on(table.appId),
    index("idx_aliases_type_value").on(table.aliasType, table.normalizedValue),
    index("idx_aliases_type_active").on(table.aliasType, table.isActive),
  ],
);

export const appMatchRules = sqliteTable(
  "app_match_rules",
  {
    id: text("id").primaryKey(),
    appId: text("app_id")
      .notNull()
      .references(() => apps.id),
    ruleType: text("rule_type").notNull(),
    ruleJson: text("rule_json").notNull(),
    priority: integer("priority").notNull().default(0),
    enabled: integer("enabled", { mode: "boolean" }).notNull().default(true),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [index("idx_match_rules_app_id").on(table.appId)],
);

export const appScorecards = sqliteTable(
  "app_scorecards",
  {
    id: text("id").primaryKey(),
    appId: text("app_id")
      .notNull()
      .references(() => apps.id),
    sourceTypesPresent: text("source_types_present"),
    latestFetchSuccessAt: text("latest_fetch_success_at"),
    recentFetchSuccessRate: integer("recent_fetch_success_rate"),
    recentParseSuccessRate: integer("recent_parse_success_rate"),
    latestReleaseConfidence: integer("latest_release_confidence"),
    artifactTrustStatus: text("artifact_trust_status"),
    inventoryMatchSuccessRate: integer("inventory_match_success_rate"),
    ambiguityRate: integer("ambiguity_rate"),
    activeOverrideCount: integer("active_override_count").notNull().default(0),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [uniqueIndex("idx_scorecards_app_id").on(table.appId)],
);

export const onboardingChecklists = sqliteTable(
  "onboarding_checklists",
  {
    id: text("id").primaryKey(),
    appId: text("app_id")
      .notNull()
      .references(() => apps.id),
    hasCanonicalRecord: integer("has_canonical_record", { mode: "boolean" })
      .notNull()
      .default(false),
    hasAliases: integer("has_aliases", { mode: "boolean" }).notNull().default(false),
    hasSource: integer("has_source", { mode: "boolean" }).notNull().default(false),
    parserOutputVerified: integer("parser_output_verified", { mode: "boolean" })
      .notNull()
      .default(false),
    latestReleasePublished: integer("latest_release_published", { mode: "boolean" })
      .notNull()
      .default(false),
    reviewQueueClear: integer("review_queue_clear", { mode: "boolean" }).notNull().default(false),
    qualityScoreAcceptable: integer("quality_score_acceptable", { mode: "boolean" })
      .notNull()
      .default(false),
    isComplete: integer("is_complete", { mode: "boolean" }).notNull().default(false),
    completedAt: text("completed_at"),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [uniqueIndex("idx_onboarding_app_id").on(table.appId)],
);
