import { z } from "zod";

export const installStrategySchema = z.enum([
  "sparkle",
  "zip_replace",
  "dmg_copy_replace",
  "pkg_install",
  "mac_app_store",
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

export type InstallStrategy = z.infer<typeof installStrategySchema>;
export type AppArtifact = z.infer<typeof appArtifactSchema>;
