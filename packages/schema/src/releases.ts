import { sqliteTable, text, integer, index, uniqueIndex } from "drizzle-orm/sqlite-core";

import { apps } from "./catalog";
import { parserRuns } from "./sources";

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
    channel: text("channel", { enum: ["stable", "beta", "nightly"] })
      .notNull()
      .default("stable"),
    releasedAt: text("released_at"),
    isPrerelease: integer("is_prerelease", { mode: "boolean" }).notNull().default(false),
    sourceConfidence: integer("source_confidence"),
    status: text("status", { enum: ["active", "retracted", "superseded", "draft"] })
      .notNull()
      .default("active"),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [
    index("idx_releases_app_id").on(table.appId),
    index("idx_releases_app_channel").on(table.appId, table.channel),
    index("idx_releases_version").on(table.appId, table.versionNormalized),
    index("idx_releases_status").on(table.status),
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
    artifactType: text("artifact_type", {
      enum: ["zip", "dmg", "pkg", "appcast_enclosure", "other"],
    }).notNull(),
    url: text("url").notNull(),
    urlHash: text("url_hash"),
    sha256: text("sha256"),
    sizeBytes: integer("size_bytes"),
    architecture: text("architecture"),
    minOsVersion: text("min_os_version"),
    signatureStatus: text("signature_status", {
      enum: ["unknown", "valid", "invalid", "missing"],
    }).default("unknown"),
    notarizationStatus: text("notarization_status", {
      enum: ["unknown", "notarized", "not_notarized"],
    }).default("unknown"),
    expectedTeamId: text("expected_team_id"),
    observedTeamId: text("observed_team_id"),
    teamIdMatch: text("team_id_match", {
      enum: ["unknown", "match", "mismatch"],
    }).default("unknown"),
    signatureObservationJson: text("signature_observation_json"),
    notarizationObservationJson: text("notarization_observation_json"),
    trustLevel: text("trust_level", {
      enum: ["unknown", "untrusted", "low", "medium", "high"],
    }).default("unknown"),
    isPrimary: integer("is_primary", { mode: "boolean" }).notNull().default(false),
    createdAt: text("created_at").notNull(),
  },
  (table) => [index("idx_artifacts_release_id").on(table.releaseId)],
);

export const artifactObservations = sqliteTable(
  "artifact_observations",
  {
    id: text("id").primaryKey(),
    artifactId: text("artifact_id")
      .notNull()
      .references(() => artifacts.id),
    observationType: text("observation_type", {
      enum: ["signature", "notarization", "team_id", "bundle_id", "content_hash"],
    }).notNull(),
    status: text("status", {
      enum: ["pass", "fail", "unknown", "skipped"],
    }).notNull(),
    observedValue: text("observed_value"),
    expectedValue: text("expected_value"),
    detailJson: text("detail_json"),
    observedAt: text("observed_at").notNull(),
  },
  (table) => [index("idx_artifact_obs_artifact_id").on(table.artifactId)],
);

export const artifactContents = sqliteTable(
  "artifact_contents",
  {
    id: text("id").primaryKey(),
    artifactId: text("artifact_id")
      .notNull()
      .references(() => artifacts.id),
    contentType: text("content_type"),
    pathWithinArtifact: text("path_within_artifact"),
    bundleId: text("bundle_id"),
    appName: text("app_name"),
    versionRaw: text("version_raw"),
    versionNormalized: text("version_normalized"),
    teamId: text("team_id"),
    executableSha256: text("executable_sha256"),
    createdAt: text("created_at").notNull(),
  },
  (table) => [index("idx_artifact_contents_artifact_id").on(table.artifactId)],
);

export const appLatestReleases = sqliteTable(
  "app_latest_releases",
  {
    id: text("id").primaryKey(),
    appId: text("app_id")
      .notNull()
      .references(() => apps.id),
    channel: text("channel", { enum: ["stable", "beta", "nightly"] })
      .notNull()
      .default("stable"),
    releaseId: text("release_id")
      .notNull()
      .references(() => releases.id),
    artifactId: text("artifact_id"),
    versionNormalized: text("version_normalized").notNull(),
    versionRaw: text("version_raw").notNull(),
    releasedAt: text("released_at"),
    decisionSource: text("decision_source", { enum: ["pipeline", "override", "manual"] })
      .notNull()
      .default("pipeline"),
    confidence: integer("confidence"),
    decisionExplanationJson: text("decision_explanation_json"),
    installabilityClass: text("installability_class", {
      enum: ["notify_only", "assisted_download", "assisted_replace", "automation_candidate"],
    }).default("notify_only"),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [uniqueIndex("idx_latest_app_channel").on(table.appId, table.channel)],
);

export const installRules = sqliteTable(
  "install_rules",
  {
    id: text("id").primaryKey(),
    appId: text("app_id")
      .notNull()
      .references(() => apps.id),
    strategy: text("strategy", {
      enum: ["sparkle", "zip_replace", "dmg_copy_replace", "pkg_manual", "manual_only"],
    }).notNull(),
    requiresQuit: integer("requires_quit", { mode: "boolean" }).notNull().default(true),
    requiresAdmin: integer("requires_admin", { mode: "boolean" }).notNull().default(false),
    supportsSilent: integer("supports_silent", { mode: "boolean" }).notNull().default(false),
    rollbackSupported: integer("rollback_supported", { mode: "boolean" }).notNull().default(false),
    ruleConfidence: integer("rule_confidence"),
    enabled: integer("enabled", { mode: "boolean" }).notNull().default(true),
    notes: text("notes"),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [index("idx_install_rules_app_id").on(table.appId)],
);
