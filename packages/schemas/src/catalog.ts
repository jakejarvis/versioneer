import { z } from "zod";

export const appStatusValues = ["draft", "public", "merged", "deprecated", "unlisted"] as const;
export const appStatusSchema = z.enum(appStatusValues);
export type AppStatus = z.infer<typeof appStatusSchema>;

export const aliasTypeValues = [
  "bundle_id",
  "name",
  "team_id",
  "sparkle_feed",
  "homepage",
  "download_pattern",
  "github_repo",
  "mas_app_id",
  "electron_update_url",
  "homebrew_cask",
] as const;
export const aliasTypeSchema = z.enum(aliasTypeValues);
export type AliasType = z.infer<typeof aliasTypeSchema>;
