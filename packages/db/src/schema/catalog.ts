import { sql } from "drizzle-orm";
import { sqliteTable, text, integer, index, uniqueIndex } from "drizzle-orm/sqlite-core";

import { aliasTypeValues, appStatusValues } from "@versioneer/schemas/catalog";

export const apps = sqliteTable(
  "apps",
  {
    id: text("id").primaryKey(),
    slug: text("slug").notNull().unique(),
    canonicalName: text("canonical_name").notNull(),
    vendorName: text("vendor_name"),
    homepageUrl: text("homepage_url"),
    status: text("status", { enum: appStatusValues }).notNull().default("draft"),
    mergedIntoAppId: text("merged_into_app_id"),
    notes: text("notes"),
    defaultReleaseNotesUrl: text("default_release_notes_url"),
    iconR2Key: text("icon_r2_key"),
    publicTrackedAt: text("public_tracked_at"),
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
    aliasType: text("alias_type", { enum: aliasTypeValues }).notNull(),
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
    uniqueIndex("idx_aliases_unique_active_exact_bundle_id")
      .on(table.aliasType, table.normalizedValue)
      .where(
        sql`${table.isActive} = 1 and ${table.isExact} = 1 and ${table.aliasType} = 'bundle_id'`,
      ),
    uniqueIndex("idx_aliases_unique_active_exact_sparkle_feed")
      .on(table.aliasType, table.normalizedValue)
      .where(
        sql`${table.isActive} = 1 and ${table.isExact} = 1 and ${table.aliasType} = 'sparkle_feed'`,
      ),
    uniqueIndex("idx_aliases_unique_active_exact_mas_app_id")
      .on(table.aliasType, table.normalizedValue)
      .where(
        sql`${table.isActive} = 1 and ${table.isExact} = 1 and ${table.aliasType} = 'mas_app_id'`,
      ),
    uniqueIndex("idx_aliases_unique_active_exact_electron_update_url")
      .on(table.aliasType, table.normalizedValue)
      .where(
        sql`${table.isActive} = 1 and ${table.isExact} = 1 and ${table.aliasType} = 'electron_update_url'`,
      ),
    uniqueIndex("idx_aliases_unique_active_exact_homebrew_cask")
      .on(table.aliasType, table.normalizedValue)
      .where(
        sql`${table.isActive} = 1 and ${table.isExact} = 1 and ${table.aliasType} = 'homebrew_cask'`,
      ),
  ],
);
