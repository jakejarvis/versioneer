import {
  executionRouteSchema as installExecutionRouteSchema,
  type ExecutionRoute as InstallExecutionRoute,
  installExecutionStatusSchema,
  type InstallExecutionStatus,
} from "@versioneer/schemas/ops";
import { installStrategySchema, type InstallStrategy } from "@versioneer/schemas/releases";
import { z } from "zod";

export const appArtifactSchema = z.object({
  id: z.string().nullable(),
  downloadUrl: z.string().nullable(),
  architecture: z.string().nullable(),
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

const installExecutionBaseSchema = z.object({
  client: installExecutionClientSchema,
  appId: z.string().min(1),
  releaseId: z.string().min(1),
  artifactId: z.string().min(1).nullable().optional(),
  installStrategy: installStrategySchema,
  executionRoute: installExecutionRouteSchema.optional(),
  channel: z.string().max(100).nullable().optional(),
  previousVersion: z.string().max(200).nullable().optional(),
  bundleId: z.string().max(500).nullable().optional(),
  teamId: z.string().max(100).nullable().optional(),
});

export const installPrepareRequestSchema = installExecutionBaseSchema;

export const installPrepareResponseSchema = z.object({
  executionId: z.string().min(1),
  status: z.literal("prepared"),
});

export const installExecutionStatusRequestSchema = installExecutionBaseSchema.extend({
  status: z.enum(["started", "succeeded", "failed", "cancelled"]),
  installedVersion: z.string().max(200).nullable().optional(),
  errorMessage: z.string().max(4000).nullable().optional(),
  verification: installVerificationSummarySchema.nullable().optional(),
});

export const installExecutionStatusResponseSchema = z.object({
  executionId: z.string().min(1),
  status: z.literal("recorded"),
});

export type { InstallStrategy, InstallExecutionRoute, InstallExecutionStatus };
export type AppArtifact = z.infer<typeof appArtifactSchema>;
export type InstallExecutionClient = z.infer<typeof installExecutionClientSchema>;
export type InstallVerificationSummary = z.infer<typeof installVerificationSummarySchema>;
export type InstallPrepareRequest = z.infer<typeof installPrepareRequestSchema>;
export type InstallPrepareResponse = z.infer<typeof installPrepareResponseSchema>;
export type InstallExecutionStatusRequest = z.infer<typeof installExecutionStatusRequestSchema>;
export type InstallExecutionStatusResponse = z.infer<typeof installExecutionStatusResponseSchema>;
