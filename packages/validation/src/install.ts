import { z } from "zod";

export const installStrategySchema = z.enum([
  "sparkle",
  "zip_replace",
  "dmg_copy_replace",
  "pkg_install",
  "pkg_manual",
  "manual_only",
]);

export const installabilityClassSchema = z.enum([
  "notify_only",
  "assisted_download",
  "assisted_replace",
  "automation_candidate",
]);

export const installEligibilitySchema = z.enum([
  "eligible",
  "requires_warning",
  "not_supported",
  "manual_only",
  "mas_app",
]);

export const appArtifactSchema = z.object({
  id: z.string().nullable(),
  downloadUrl: z.string().nullable(),
  architecture: z.string().nullable(),
  minOsVersion: z.string().nullable(),
  artifactType: z.string().nullable(),
  sizeBytes: z.number().nullable(),
  sha256: z.string().nullable(),
  expectedTeamId: z.string().nullable(),
  expectedBundleId: z.string().nullable(),
  expectedVersionRaw: z.string().nullable(),
});

export const appInstallMetadataSchema = z.object({
  canInstall: z.boolean(),
  installabilityClass: installabilityClassSchema.nullable(),
  strategy: installStrategySchema.nullable(),
  requiresQuit: z.boolean(),
  requiresAdmin: z.boolean(),
  supportsSilent: z.boolean(),
  eligibility: installEligibilitySchema,
});

export const localVerificationChecksSchema = z.object({
  requireHash: z.boolean(),
  requireSignature: z.boolean(),
  requireNotarization: z.boolean(),
  requireBundleIdMatch: z.boolean(),
  requireTeamIdMatch: z.boolean(),
  requireVersionMatch: z.boolean(),
});

export const installPlanSchema = z.object({
  executionId: z.string(),
  appId: z.string(),
  releaseId: z.string(),
  strategy: installStrategySchema,
  installabilityClass: installabilityClassSchema,
  warningLevel: z.enum(["none", "provisional"]),
  requiresQuit: z.boolean(),
  requiresAdmin: z.boolean(),
  supportsSilent: z.boolean(),
  relaunchAfterInstall: z.boolean(),
  artifact: appArtifactSchema.nullable(),
  localVerification: localVerificationChecksSchema,
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

export const installPrepareResponseSchema = z.object({
  executionId: z.string(),
  plan: installPlanSchema,
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
export type InstallabilityClass = z.infer<typeof installabilityClassSchema>;
export type InstallEligibility = z.infer<typeof installEligibilitySchema>;
export type AppArtifact = z.infer<typeof appArtifactSchema>;
export type AppInstallMetadata = z.infer<typeof appInstallMetadataSchema>;
export type LocalVerificationChecks = z.infer<typeof localVerificationChecksSchema>;
export type InstallPlan = z.infer<typeof installPlanSchema>;
export type InstallPrepareRequest = z.infer<typeof installPrepareRequestSchema>;
export type InstallPrepareResponse = z.infer<typeof installPrepareResponseSchema>;
export type InstallExecutionStatusUpdate = z.infer<typeof installExecutionStatusUpdateSchema>;
