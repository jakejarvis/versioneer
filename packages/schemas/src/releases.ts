import { z } from "zod";

export const releaseStatusValues = ["active", "superseded", "draft"] as const;
export const releaseStatusSchema = z.enum(releaseStatusValues);
export type ReleaseStatus = z.infer<typeof releaseStatusSchema>;

export const artifactTypeValues = [
  "zip",
  "dmg",
  "pkg",
  "appcast_enclosure",
  "mac_app_store",
  "other",
] as const;
export const artifactTypeSchema = z.enum(artifactTypeValues);
export type ArtifactType = z.infer<typeof artifactTypeSchema>;

export const installStrategyValues = [
  "sparkle",
  "zip_replace",
  "dmg_copy_replace",
  "pkg_install",
  "mac_app_store",
  "manual_only",
] as const;
export const installStrategySchema = z.enum(installStrategyValues);
export type InstallStrategy = z.infer<typeof installStrategySchema>;
