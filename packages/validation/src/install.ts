import { z } from "zod";

export const installStrategySchema = z.enum([
  "sparkle",
  "zip_replace",
  "dmg_copy_replace",
  "pkg_install",
  "manual_only",
]);

export const appArtifactSchema = z.object({
  id: z.string().nullable(),
  downloadUrl: z.string().nullable(),
  architecture: z.string().nullable(),
  minOsVersion: z.string().nullable(),
  artifactType: z.string().nullable(),
  sizeBytes: z.number().nullable(),
  sha256: z.string().nullable(),
});

export const installPrepareRequestSchema = z.object({
  installId: z.string().min(1).max(200),
  snapshotId: z.string().min(1).max(200),
  matchedAppId: z.string().min(1).max(200),
  releaseId: z.string().min(1).max(200),
  installedVersion: z.string().max(200).nullable().optional(),
  localAppPath: z.string().min(1).max(4000),
  strategyCandidate: installStrategySchema,
});

export const installExecutionStatusUpdateSchema = z.object({
  installId: z.string().min(1).max(200),
  actionStatus: z.enum(["in_progress", "completed", "failed", "cancelled"]),
  clientVersionAfter: z.string().max(200).nullable().optional(),
  errorMessage: z.string().max(5000).nullable().optional(),
  durationMs: z.number().int().min(0).nullable().optional(),
  detailsJson: z.string().max(20000).nullable().optional(),
});

export type InstallStrategy = z.infer<typeof installStrategySchema>;
export type AppArtifact = z.infer<typeof appArtifactSchema>;
export type InstallPrepareRequest = z.infer<typeof installPrepareRequestSchema>;
export type InstallExecutionStatusUpdate = z.infer<typeof installExecutionStatusUpdateSchema>;
