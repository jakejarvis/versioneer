import { z } from "zod";

import { targetArchitectureSchema } from "@versioneer/schemas/architecture";

import { channelSchema } from "./common";
import { appArtifactSchema, installStrategySchema, installTrustSchema } from "./install";

export const installedAppSchema = z.object({
  appName: z.string().min(1).max(500),
  bundleId: z.string().max(500).optional(),
  version: z.string().max(200).optional(),
  buildNumber: z.string().max(200).optional(),
  teamId: z.string().max(100).optional(),
  architecture: z.string().max(50).optional(),
  sparkleFeedUrl: z.string().max(2000).optional(),
  sparklePublicKey: z.string().max(500).optional(),
  isSparkleApp: z.boolean().optional(),
  isMasApp: z.boolean().optional(),
  masAppId: z.string().max(100).optional(),
  isElectronApp: z.boolean().optional(),
  electronUpdateProvider: z.string().max(100).optional(),
  electronUpdateUrl: z.string().max(2000).optional(),
  codeSigningAuthority: z.string().max(500).optional(),
  appCategory: z.string().max(200).optional(),
  minMacOSVersion: z.string().max(50).optional(),
  iconBase64: z.string().max(500000).optional(),
  isHomebrewInstalled: z.boolean().optional(),
  homebrewCaskToken: z.string().max(200).optional(),
});

export type InstalledApp = z.infer<typeof installedAppSchema>;

const inventoryClientSchema = z.object({
  platform: z.string().default("macos"),
  appVersion: z.string().max(50).optional(),
  osVersion: z.string().max(50).optional(),
  systemArchitecture: z.string().max(50).optional(),
  channelPreferences: z
    .object({
      defaultChannel: channelSchema.default("stable"),
      perApp: z.record(z.string(), channelSchema).default({}),
    })
    .optional(),
});

export type InventoryClient = z.infer<typeof inventoryClientSchema>;

/** Validates the request envelope (client info + array shape) without per-app validation. */
export const inventoryRequestEnvelopeSchema = z.object({
  client: inventoryClientSchema,
  apps: z.array(z.unknown()).max(5000),
  scanDurationMs: z.number().int().optional(),
});

/** Full request schema — used in contract tests and type inference. The API route validates apps individually via installedAppSchema. */
export const inventoryCheckRequestSchema = z.object({
  client: inventoryClientSchema,
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
  decision: z.enum(["up_to_date", "update_available", "ambiguous", "local_only", "incompatible"]),
  trackingState: z.enum(["public", "local_only"]),
  localReasonCode: z
    .enum([
      "no_public_identity",
      "no_approved_source",
      "matched_draft",
      "ambiguous_match",
      "not_found",
      "no_compatible_release",
    ])
    .nullable(),
  latestVersion: z.string().nullable(),
  latestVersionRaw: z.string().nullable(),
  latestReleaseId: z.string().nullable(),
  targetArchitecture: targetArchitectureSchema.nullable(),
  channel: z.string().nullable().optional(),
  availableChannels: z.array(z.string()).optional(),
  homebrewCaskToken: z.string().nullable().optional(),
  releasedAt: z.string().nullable(),
  staleSince: z.string().nullable(),
  iconUrl: z.string().nullable(),
  artifact: appArtifactSchema.nullable(),
  installStrategy: installStrategySchema.nullable(),
  installTrust: installTrustSchema,
});

export type AppDecision = z.infer<typeof appDecisionSchema>;

export const skippedAppSchema = z.object({
  index: z.number(),
  appName: z.string().nullable(),
  reasons: z.array(z.string()),
});

export type SkippedApp = z.infer<typeof skippedAppSchema>;

export const inventoryCheckResponseSchema = z.object({
  results: z.array(appDecisionSchema),
  skipped: z.array(skippedAppSchema).optional(),
  processedAt: z.string(),
});

export type InventoryCheckResponse = z.infer<typeof inventoryCheckResponseSchema>;
