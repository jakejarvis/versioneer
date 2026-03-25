import { sqliteTable, text, integer, index } from "drizzle-orm/sqlite-core";

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
