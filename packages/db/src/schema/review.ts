import { index, integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

import {
  assertionTypeValues,
  evidenceTypeValues,
  queueTypeValues,
  suggestionStatusValues,
} from "@versioneer/schemas/review";

import { apps } from "./catalog";
import { sources } from "./sources";

export const catalogSuggestions = sqliteTable(
  "catalog_suggestions",
  {
    id: text("id").primaryKey(),
    queueType: text("queue_type", { enum: queueTypeValues }).notNull(),
    status: text("status", { enum: suggestionStatusValues }).notNull().default("pending"),
    appId: text("app_id").references(() => apps.id),
    sourceId: text("source_id").references(() => sources.id),
    bundleKey: text("bundle_key"),
    dedupeKey: text("dedupe_key").notNull(),
    title: text("title").notNull(),
    canonicalSnapshotJson: text("canonical_snapshot_json"),
    proposedChangeJson: text("proposed_change_json").notNull(),
    evidenceSummaryJson: text("evidence_summary_json"),
    evidenceCount: integer("evidence_count").notNull().default(0),
    firstSeenAt: text("first_seen_at").notNull(),
    lastSeenAt: text("last_seen_at").notNull(),
    reviewedAt: text("reviewed_at"),
    reviewedBy: text("reviewed_by"),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [
    uniqueIndex("idx_catalog_suggestions_dedupe_key").on(table.dedupeKey),
    index("idx_catalog_suggestions_status").on(table.status),
    index("idx_catalog_suggestions_queue_type").on(table.queueType),
    index("idx_catalog_suggestions_created_at").on(table.createdAt),
    index("idx_catalog_suggestions_bundle_key").on(table.bundleKey),
    index("idx_catalog_suggestions_app_id").on(table.appId),
  ],
);

export const suggestionEvidence = sqliteTable(
  "suggestion_evidence",
  {
    id: text("id").primaryKey(),
    suggestionId: text("suggestion_id")
      .notNull()
      .references(() => catalogSuggestions.id),
    appId: text("app_id").references(() => apps.id),
    sourceId: text("source_id").references(() => sources.id),
    evidenceType: text("evidence_type", { enum: evidenceTypeValues }).notNull(),
    fingerprint: text("fingerprint").notNull(),
    payloadJson: text("payload_json").notNull(),
    observedAt: text("observed_at").notNull(),
    createdAt: text("created_at").notNull(),
  },
  (table) => [
    uniqueIndex("idx_suggestion_evidence_fingerprint").on(table.suggestionId, table.fingerprint),
    index("idx_suggestion_evidence_suggestion_id").on(table.suggestionId),
    index("idx_suggestion_evidence_type").on(table.evidenceType),
  ],
);

export const trustAssertions = sqliteTable(
  "trust_assertions",
  {
    id: text("id").primaryKey(),
    appId: text("app_id").references(() => apps.id),
    sourceId: text("source_id").references(() => sources.id),
    assertionType: text("assertion_type", { enum: assertionTypeValues }).notNull(),
    value: text("value").notNull(),
    reviewedAt: text("reviewed_at"),
    reviewedBy: text("reviewed_by"),
    createdAt: text("created_at").notNull(),
  },
  (table) => [
    index("idx_trust_assertions_app_id").on(table.appId),
    index("idx_trust_assertions_source_id").on(table.sourceId),
    index("idx_trust_assertions_type").on(table.assertionType),
  ],
);
