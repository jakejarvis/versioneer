import { inferChannel, isPreRelease } from "../versioning";
import type { SourceParser, ParserOutput, ParsedRelease, ParsedArtifact } from "./types";

interface GitHubRelease {
  tag_name: string;
  name?: string;
  prerelease?: boolean;
  draft?: boolean;
  published_at?: string;
  html_url?: string;
  body?: string;
  assets?: GitHubAsset[];
}

interface GitHubAsset {
  name: string;
  browser_download_url: string;
  size: number;
  content_type: string;
}

export const githubReleasesParser: SourceParser = {
  key: "github_releases",
  version: "1.1.0",

  parse(body: string, _config?: Record<string, unknown>): ParserOutput {
    const releases: ParsedRelease[] = [];
    const errors: string[] = [];

    try {
      const data = JSON.parse(body) as GitHubRelease[];

      if (!Array.isArray(data)) {
        errors.push("Expected array of releases");
        return { releases, confidence: 0, parserVersion: this.version, errors };
      }

      for (const ghRelease of data) {
        try {
          // Skip drafts
          if (ghRelease.draft) continue;

          const versionRaw = ghRelease.tag_name.replace(/^[vV]/, "");
          if (!versionRaw) continue;

          const artifacts: ParsedArtifact[] = [];
          if (ghRelease.assets) {
            for (const asset of ghRelease.assets) {
              if (isMacArtifact(asset.name)) {
                artifacts.push({
                  url: asset.browser_download_url,
                  type: inferArtifactType(asset.name),
                  sizeBytes: asset.size,
                  architecture: inferArchitecture(asset.name),
                });
              }
            }
          }

          const release: ParsedRelease = {
            versionRaw,
            channel: ghRelease.prerelease
              ? inferChannel(versionRaw) === "stable"
                ? "beta"
                : inferChannel(versionRaw)
              : inferChannel(versionRaw),
            isPrerelease: ghRelease.prerelease || isPreRelease(versionRaw),
            publishedAt: ghRelease.published_at ?? undefined,
            releaseNotesUrl: ghRelease.html_url ?? undefined,
            releaseNotesBody: ghRelease.body ?? undefined,
            releaseNotesFormat: ghRelease.body ? ("markdown" as const) : undefined,
            artifacts,
          };

          releases.push(release);
        } catch (e) {
          errors.push(
            `Failed to parse release ${ghRelease.tag_name}: ${e instanceof Error ? e.message : String(e)}`,
          );
        }
      }
    } catch (e) {
      errors.push(`Failed to parse JSON: ${e instanceof Error ? e.message : String(e)}`);
    }

    return {
      releases,
      confidence: releases.length > 0 ? 85 : 0,
      parserVersion: githubReleasesParser.version,
      errors,
    };
  },
};

function isMacArtifact(name: string): boolean {
  const lower = name.toLowerCase();
  const hasMacKeyword =
    lower.includes("mac") ||
    lower.includes("darwin") ||
    lower.includes("osx") ||
    lower.includes("macos") ||
    lower.includes("apple");
  // .dmg and .pkg are mac-only formats
  if (lower.endsWith(".dmg") || lower.endsWith(".pkg")) return true;
  // .zip is cross-platform — only match if the name indicates macOS
  if (lower.endsWith(".zip") && hasMacKeyword) return true;
  // Non-archive files with mac keywords (e.g. "MyApp-mac.tar.gz")
  if (hasMacKeyword) return true;
  return false;
}

function inferArtifactType(name: string): ParsedArtifact["type"] {
  const lower = name.toLowerCase();
  if (lower.endsWith(".dmg")) return "dmg";
  if (lower.endsWith(".zip")) return "zip";
  if (lower.endsWith(".pkg")) return "pkg";
  return "other";
}

function inferArchitecture(name: string): string | undefined {
  const lower = name.toLowerCase();
  if (
    lower.includes("arm64") ||
    lower.includes("aarch64") ||
    lower.includes("apple-silicon") ||
    lower.includes("silicon")
  )
    return "arm64";
  if (lower.includes("x86_64") || lower.includes("amd64") || lower.includes("intel"))
    return "x86_64";
  if (lower.includes("universal")) return "universal";
  return undefined;
}
