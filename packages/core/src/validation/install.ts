import { z } from "zod";

import {
  artifactArchitectureSchema,
  targetArchitectureSchema,
  type TargetArchitecture,
} from "@versioneer/schemas/architecture";
import {
  executionRouteSchema as installExecutionRouteSchema,
  type ExecutionRoute as InstallExecutionRoute,
  installExecutionStatusSchema,
  type InstallExecutionStatus,
} from "@versioneer/schemas/ops";
import { installStrategySchema, type InstallStrategy } from "@versioneer/schemas/releases";

export const installTrustStatusValues = ["one_click", "manual_only", "external", "none"] as const;
export const installTrustStatusSchema = z.enum(installTrustStatusValues);

export const installTrustReasonValues = [
  "missing_artifact",
  "missing_sha256",
  "missing_bundle_id",
  "missing_team_id",
  "missing_sparkle_public_key",
  "mac_app_store_external",
  "homebrew_external",
  "manual_only",
  "unsupported_strategy",
  "unknown_architecture",
] as const;
export const installTrustReasonSchema = z.enum(installTrustReasonValues);

export const installTrustSchema = z.object({
  status: installTrustStatusSchema,
  resolvedStrategy: installStrategySchema.nullable(),
  reasons: z.array(installTrustReasonSchema),
});

export const appArtifactSchema = z.object({
  id: z.string().nullable(),
  downloadUrl: z.string().nullable(),
  architecture: artifactArchitectureSchema.nullable(),
  minOsVersion: z.string().nullable(),
  artifactType: z.string().nullable(),
  sizeBytes: z.number().nullable(),
  sha256: z.string().nullable(),
});

export { installExecutionRouteSchema, installExecutionStatusSchema, installStrategySchema };

export const installExecutionClientSchema = z.object({
  platform: z.string().default("macos"),
  appVersion: z.string().max(50).optional(),
  osVersion: z.string().max(50).optional(),
  systemArchitecture: z.string().max(50).optional(),
});

export const installVerificationSummarySchema = z.object({
  strategy: installStrategySchema,
  executionRoute: installExecutionRouteSchema.optional(),
  hashVerified: z.boolean().nullable().optional(),
  signatureVerified: z.boolean().nullable().optional(),
  notarizationVerified: z.boolean().nullable().optional(),
  bundleIdMatch: z.boolean().nullable().optional(),
  teamIdMatch: z.boolean().nullable().optional(),
  versionMatch: z.boolean().nullable().optional(),
  observedBundleId: z.string().max(500).nullable().optional(),
  observedTeamId: z.string().max(100).nullable().optional(),
  observedVersion: z.string().max(200).nullable().optional(),
});

export const installExecutionTargetSchema = z.object({
  appId: z.string().min(1),
  releaseId: z.string().min(1),
  artifactId: z.string().min(1).nullable().optional(),
  targetArchitecture: targetArchitectureSchema.nullable().optional(),
  channel: z.string().max(100).nullable().optional(),
});

export const installExecutionPlanSchema = z.object({
  strategy: installStrategySchema,
  executionRoute: installExecutionRouteSchema.optional(),
});

export const installExecutionExpectedSchema = z.object({
  previousVersion: z.string().max(200).nullable().optional(),
  bundleId: z.string().max(500).nullable().optional(),
  teamId: z.string().max(100).nullable().optional(),
});

export const installExecutionCreateRequestSchema = z.object({
  client: installExecutionClientSchema,
  target: installExecutionTargetSchema,
  install: installExecutionPlanSchema,
  expected: installExecutionExpectedSchema,
});

export const installExecutionCreateResponseSchema = z.object({
  execution: z.object({
    id: z.string().min(1),
    status: z.literal("prepared"),
  }),
});

export const installExecutionEventRequestSchema = z.object({
  client: installExecutionClientSchema,
  target: installExecutionTargetSchema,
  install: installExecutionPlanSchema,
  expected: installExecutionExpectedSchema,
  event: z.object({
    status: z.enum(["started", "succeeded", "failed", "cancelled"]),
    installedVersion: z.string().max(200).nullable().optional(),
    errorMessage: z.string().max(4000).nullable().optional(),
  }),
  verification: installVerificationSummarySchema.nullable().optional(),
});

export const installExecutionEventResponseSchema = z.object({
  execution: z.object({
    id: z.string().min(1),
    status: z.literal("recorded"),
  }),
});

export type { InstallStrategy, InstallExecutionRoute, InstallExecutionStatus };
export type InstallTrustStatus = z.infer<typeof installTrustStatusSchema>;
export type InstallTrustReason = z.infer<typeof installTrustReasonSchema>;
export type InstallTrust = z.infer<typeof installTrustSchema>;
export type AppArtifact = z.infer<typeof appArtifactSchema>;
export type InstallExecutionClient = z.infer<typeof installExecutionClientSchema>;
export type { TargetArchitecture };
export type InstallVerificationSummary = z.infer<typeof installVerificationSummarySchema>;
export type InstallExecutionTarget = z.infer<typeof installExecutionTargetSchema>;
export type InstallExecutionPlan = z.infer<typeof installExecutionPlanSchema>;
export type InstallExecutionExpected = z.infer<typeof installExecutionExpectedSchema>;
export type InstallExecutionCreateRequest = z.infer<typeof installExecutionCreateRequestSchema>;
export type InstallExecutionCreateResponse = z.infer<typeof installExecutionCreateResponseSchema>;
export type InstallExecutionEventRequest = z.infer<typeof installExecutionEventRequestSchema>;
export type InstallExecutionEventResponse = z.infer<typeof installExecutionEventResponseSchema>;
