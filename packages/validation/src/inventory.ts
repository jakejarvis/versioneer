import { z } from "zod";

import { appArtifactSchema, appInstallMetadataSchema } from "./install";

export const installedAppSchema = z.object({
  appName: z.string().min(1).max(500),
  bundleId: z.string().max(500).optional(),
  version: z.string().max(200).optional(),
  buildNumber: z.string().max(200).optional(),
  teamId: z.string().max(100).optional(),
  pathHash: z.string().max(100).optional(),
  architecture: z.string().max(50).optional(),
  sparkleFeedUrl: z.string().url().max(2000).optional(),
  isMasApp: z.boolean().optional(),
  electronUpdateUrl: z.string().url().max(2000).optional(),
});

export type InstalledApp = z.infer<typeof installedAppSchema>;

export const inventoryCheckRequestSchema = z.object({
  client: z.object({
    installId: z.string().min(1).max(200),
    platform: z.string().default("macos"),
    appVersion: z.string().max(50).optional(),
    osVersion: z.string().max(50).optional(),
    systemArchitecture: z.string().max(50).optional(),
  }),
  apps: z.array(installedAppSchema).max(5000),
  scanDurationMs: z.number().int().optional(),
});

export type InventoryCheckRequest = z.infer<typeof inventoryCheckRequestSchema>;

export const appDecisionSchema = z.object({
  appName: z.string(),
  bundleId: z.string().nullable(),
  installedVersion: z.string().nullable(),
  matchedAppId: z.string().nullable(),
  matchedAppName: z.string().nullable(),
  matchConfidence: z.number().nullable(),
  decision: z.enum([
    "unknown",
    "up_to_date",
    "update_available",
    "ambiguous",
    "unsupported",
    "ignored",
  ]),
  latestVersion: z.string().nullable(),
  latestVersionRaw: z.string().nullable(),
  latestReleaseId: z.string().nullable(),
  releasedAt: z.string().nullable(),
  iconUrl: z.string().nullable(),
  artifact: appArtifactSchema.nullable(),
  install: appInstallMetadataSchema,
});

export type AppDecision = z.infer<typeof appDecisionSchema>;

export const inventoryCheckResponseSchema = z.object({
  snapshotId: z.string(),
  results: z.array(appDecisionSchema),
  processedAt: z.string(),
});

export type InventoryCheckResponse = z.infer<typeof inventoryCheckResponseSchema>;
