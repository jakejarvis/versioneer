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
  channels: z
    .object({
      default: channelSchema.default("stable"),
      overrides: z.record(z.string(), channelSchema).default({}),
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

export const inventoryResultSchema = z.object({
  app: z.object({
    name: z.string(),
    bundleId: z.string().nullable(),
    installedVersion: z.string().nullable(),
  }),
  decision: z.enum(["up_to_date", "update_available", "ambiguous", "local_only", "incompatible"]),
  catalog: z.object({
    match: z.object({
      appId: z.string().nullable(),
      appName: z.string().nullable(),
      confidence: z.number().nullable(),
    }),
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
    iconUrl: z.string().nullable(),
    staleSince: z.string().nullable(),
  }),
  release: z.object({
    version: z.string().nullable(),
    versionRaw: z.string().nullable(),
    releaseId: z.string().nullable(),
    releasedAt: z.string().nullable(),
    targetArchitecture: targetArchitectureSchema.nullable(),
    artifact: appArtifactSchema.nullable(),
  }),
  install: z.object({
    strategy: installStrategySchema.nullable(),
    trust: installTrustSchema,
    homebrewCaskToken: z.string().nullable().optional(),
  }),
  channels: z.object({
    selected: z.string().nullable().optional(),
    available: z.array(z.string()).default([]),
  }),
});

export type InventoryResult = z.infer<typeof inventoryResultSchema>;

export const invalidInventoryAppSchema = z.object({
  index: z.number(),
  appName: z.string().nullable(),
  reasons: z.array(z.string()),
});

export type InvalidInventoryApp = z.infer<typeof invalidInventoryAppSchema>;

const inventorySubmissionSchema = z.object({
  id: z.string(),
});

export const inventoryIconUploadItemSchema = z.object({
  uploadId: z.string(),
  lookupKey: z.string(),
  appName: z.string(),
  bundleId: z.string().nullable(),
  reason: z.enum(["discovered_icon", "catalog_icon"]),
});

export type InventoryIconUploadItem = z.infer<typeof inventoryIconUploadItemSchema>;

export const inventoryIconUploadDescriptorSchema = z.object({
  uploadPath: z.string(),
  items: z.array(inventoryIconUploadItemSchema),
});

export type InventoryIconUploadDescriptor = z.infer<typeof inventoryIconUploadDescriptorSchema>;

export const inventoryCheckResponseSchema = z.object({
  results: z.array(inventoryResultSchema),
  issues: z.object({
    invalidApps: z.array(invalidInventoryAppSchema).default([]),
  }),
  processedAt: z.string(),
  submission: inventorySubmissionSchema.optional(),
  iconUpload: inventoryIconUploadDescriptorSchema.optional(),
});

export type InventoryCheckResponse = z.infer<typeof inventoryCheckResponseSchema>;

export const inventoryIconUploadRequestSchema = z.object({
  items: z
    .array(
      z.object({
        uploadId: z.string().min(1),
        iconBase64: z.string().min(1),
      }),
    )
    .max(20),
});

export type InventoryIconUploadRequest = z.infer<typeof inventoryIconUploadRequestSchema>;

export const inventoryIconUploadResponseSchema = z.object({
  submissionId: z.string(),
  results: z.array(
    z.object({
      uploadId: z.string(),
      status: z.enum(["accepted", "skipped", "invalid", "failed"]),
      reason: z.string().optional(),
      retryable: z.boolean().optional(),
    }),
  ),
});

export type InventoryIconUploadResponse = z.infer<typeof inventoryIconUploadResponseSchema>;
