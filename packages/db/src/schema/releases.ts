import { sqliteTable, text, integer, index, uniqueIndex } from "drizzle-orm/sqlite-core";

import {
  artifactArchitectureValues,
  targetArchitectureValues,
} from "@versioneer/schemas/architecture";
import {
  artifactTypeValues,
  installStrategyValues,
  releaseStatusValues,
} from "@versioneer/schemas/releases";

import { apps } from "./catalog";
import { sources, parserRuns } from "./sources";

export const releases = sqliteTable(
  "releases",
  {
    id: text("id").primaryKey(),
    appId: text("app_id")
      .notNull()
      .references(() => apps.id),
    versionRaw: text("version_raw").notNull(),
    versionNormalized: text("version_normalized").notNull(),
    buildNumber: text("build_number"),
    channel: text("channel").notNull().default("stable"),
    releasedAt: text("released_at"),
    isPrerelease: integer("is_prerelease", { mode: "boolean" }).notNull().default(false),
    sourceConfidence: integer("source_confidence"),
    publishedBySourceId: text("published_by_source_id").references(() => sources.id),
    status: text("status", { enum: releaseStatusValues }).notNull().default("active"),
    releaseNotesMarkdown: text("release_notes_markdown"),
    releaseNotesHtml: text("release_notes_html"),
    releaseNotesUrl: text("release_notes_url"),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [
    uniqueIndex("idx_releases_app_channel_version").on(
      table.appId,
      table.channel,
      table.versionNormalized,
    ),
    index("idx_releases_app_id").on(table.appId),
    index("idx_releases_app_channel").on(table.appId, table.channel),
    index("idx_releases_app_channel_status_version").on(
      table.appId,
      table.channel,
      table.status,
      table.versionNormalized,
    ),
    index("idx_releases_version").on(table.appId, table.versionNormalized),
    index("idx_releases_status").on(table.status),
    index("idx_releases_status_created").on(table.status, table.createdAt),
  ],
);

export const releaseObservations = sqliteTable(
  "release_observations",
  {
    id: text("id").primaryKey(),
    parserRunId: text("parser_run_id")
      .notNull()
      .references(() => parserRuns.id),
    appId: text("app_id")
      .notNull()
      .references(() => apps.id),
    releaseId: text("release_id"),
    observedVersionRaw: text("observed_version_raw").notNull(),
    observedVersionNormalized: text("observed_version_normalized"),
    observedBuildNumber: text("observed_build_number"),
    observedChannel: text("observed_channel"),
    observedPublishedAt: text("observed_published_at"),
    observedReleaseNotesUrl: text("observed_release_notes_url"),
    observedDownloadUrl: text("observed_download_url"),
    confidence: integer("confidence"),
    observationJson: text("observation_json"),
    createdAt: text("created_at").notNull(),
  },
  (table) => [
    index("idx_observations_parser_run").on(table.parserRunId),
    index("idx_observations_app_id").on(table.appId),
    index("idx_observations_release_id").on(table.releaseId),
  ],
);

export const artifacts = sqliteTable(
  "artifacts",
  {
    id: text("id").primaryKey(),
    releaseId: text("release_id")
      .notNull()
      .references(() => releases.id),
    artifactType: text("artifact_type", { enum: artifactTypeValues }).notNull(),
    url: text("url").notNull(),
    urlHash: text("url_hash"),
    sha256: text("sha256"),
    sizeBytes: integer("size_bytes"),
    architecture: text("architecture", { enum: artifactArchitectureValues })
      .notNull()
      .default("unknown"),
    minOsVersion: text("min_os_version"),
    isPrimary: integer("is_primary", { mode: "boolean" }).notNull().default(false),
    createdAt: text("created_at").notNull(),
  },
  (table) => [
    index("idx_artifacts_release_id").on(table.releaseId),
    uniqueIndex("idx_artifacts_release_url_hash").on(table.releaseId, table.urlHash),
  ],
);

export const appLatestReleases = sqliteTable(
  "app_latest_releases",
  {
    id: text("id").primaryKey(),
    appId: text("app_id")
      .notNull()
      .references(() => apps.id),
    channel: text("channel").notNull().default("stable"),
    targetArchitecture: text("target_architecture", { enum: targetArchitectureValues }).notNull(),
    releaseId: text("release_id")
      .notNull()
      .references(() => releases.id),
    authoritySourceId: text("authority_source_id").references(() => sources.id),
    artifactId: text("artifact_id"),
    versionNormalized: text("version_normalized").notNull(),
    versionRaw: text("version_raw").notNull(),
    releasedAt: text("released_at"),
    installStrategy: text("install_strategy", { enum: installStrategyValues }),
    pinnedReleaseId: text("pinned_release_id"),
    pinnedAt: text("pinned_at"),
    pinnedBy: text("pinned_by"),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [
    uniqueIndex("idx_latest_app_channel_arch").on(
      table.appId,
      table.channel,
      table.targetArchitecture,
    ),
    index("idx_latest_release_id").on(table.releaseId),
    index("idx_latest_channel_released").on(table.channel, table.releasedAt),
  ],
);
