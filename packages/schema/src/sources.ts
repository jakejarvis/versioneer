import { sqliteTable, text, integer, index } from "drizzle-orm/sqlite-core";

import { apps } from "./catalog";

export const sources = sqliteTable(
  "sources",
  {
    id: text("id").primaryKey(),
    appId: text("app_id")
      .notNull()
      .references(() => apps.id),
    sourceType: text("source_type", { enum: ["sparkle", "github_releases", "manual"] }).notNull(),
    label: text("label"),
    baseUrl: text("base_url"),
    configJson: text("config_json"),
    parserKey: text("parser_key").notNull(),
    pollIntervalMinutes: integer("poll_interval_minutes").notNull().default(60),
    status: text("status", { enum: ["active", "paused", "disabled", "error"] })
      .notNull()
      .default("active"),
    lastSuccessAt: text("last_success_at"),
    lastFailureAt: text("last_failure_at"),
    lastFetchedAt: text("last_fetched_at"),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [
    index("idx_sources_app_id").on(table.appId),
    index("idx_sources_status").on(table.status),
    index("idx_sources_type").on(table.sourceType),
  ],
);

export const sourceFetches = sqliteTable(
  "source_fetches",
  {
    id: text("id").primaryKey(),
    sourceId: text("source_id")
      .notNull()
      .references(() => sources.id),
    fetchStatus: text("fetch_status", {
      enum: ["success", "not_modified", "error", "timeout"],
    }).notNull(),
    httpStatus: integer("http_status"),
    etag: text("etag"),
    lastModified: text("last_modified"),
    contentType: text("content_type"),
    contentLength: integer("content_length"),
    contentHash: text("content_hash"),
    r2Key: text("r2_key"),
    errorMessage: text("error_message"),
    fetchedAt: text("fetched_at").notNull(),
  },
  (table) => [
    index("idx_fetches_source_id").on(table.sourceId),
    index("idx_fetches_status").on(table.fetchStatus),
  ],
);

export const parserRuns = sqliteTable(
  "parser_runs",
  {
    id: text("id").primaryKey(),
    sourceFetchId: text("source_fetch_id")
      .notNull()
      .references(() => sourceFetches.id),
    parserKey: text("parser_key").notNull(),
    parserVersion: text("parser_version").notNull(),
    runStatus: text("run_status", { enum: ["success", "partial", "error"] }).notNull(),
    observationCount: integer("observation_count").notNull().default(0),
    confidence: integer("confidence"),
    errorMessage: text("error_message"),
    startedAt: text("started_at").notNull(),
    finishedAt: text("finished_at"),
  },
  (table) => [index("idx_parser_runs_fetch_id").on(table.sourceFetchId)],
);

export const sourceHealthMetrics = sqliteTable(
  "source_health_metrics",
  {
    id: text("id").primaryKey(),
    sourceId: text("source_id")
      .notNull()
      .references(() => sources.id),
    periodStart: text("period_start").notNull(),
    fetchAttempts: integer("fetch_attempts").notNull().default(0),
    fetchSuccesses: integer("fetch_successes").notNull().default(0),
    fetchFailures: integer("fetch_failures").notNull().default(0),
    parseAttempts: integer("parse_attempts").notNull().default(0),
    parseSuccesses: integer("parse_successes").notNull().default(0),
    parseFailures: integer("parse_failures").notNull().default(0),
    reviewItemsCreated: integer("review_items_created").notNull().default(0),
    createdAt: text("created_at").notNull(),
  },
  (table) => [
    index("idx_health_source_id").on(table.sourceId),
    index("idx_health_source_period").on(table.sourceId, table.periodStart),
  ],
);
