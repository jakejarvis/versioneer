import { inferChannel, isPreRelease } from "../versioning";
import type { ParsedArtifact, ParsedRelease, ParserOutput, SourceParser } from "./types";

export const electronGenericParser: SourceParser = {
  key: "electron_generic",
  version: "1.0.0",

  parse(body: string, config?: Record<string, unknown>): ParserOutput {
    const releases: ParsedRelease[] = [];
    const errors: string[] = [];

    try {
      const yaml = parseSimpleYaml(body);
      const versionRaw = yaml.version;
      if (!versionRaw) {
        errors.push("Missing version");
        return { releases, confidence: 0, parserVersion: this.version, errors };
      }

      const artifactPath = yaml.path ?? yaml.url ?? extractFirstFileUrl(body);
      const artifact: ParsedArtifact[] = artifactPath
        ? [
            {
              url: resolveArtifactUrl(config?.sourceBaseUrl, artifactPath),
              type: inferArtifactType(artifactPath),
              signature: yaml.sha512,
              sizeBytes: yaml.filesize ? parsePositiveInt(yaml.filesize) : undefined,
            },
          ]
        : [];

      const release: ParsedRelease = {
        versionRaw,
        channel: inferChannel(versionRaw),
        isPrerelease: isPreRelease(versionRaw),
        publishedAt: yaml.releaseDate,
        artifacts: artifact,
        metadata: {
          rawFeedType: "electron_generic",
          releaseName: yaml.releaseName,
          baseUrl: config?.sourceBaseUrl ?? null,
        },
      };

      releases.push(release);
    } catch (error) {
      errors.push(
        `Failed to parse electron generic feed: ${error instanceof Error ? error.message : String(error)}`,
      );
    }

    return {
      releases,
      confidence: releases.length > 0 ? 82 : 0,
      parserVersion: electronGenericParser.version,
      errors,
    };
  },
};

function parseSimpleYaml(body: string): Record<string, string> {
  const result: Record<string, string> = {};

  for (const line of body.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const separator = trimmed.indexOf(":");
    if (separator <= 0) continue;
    const key = trimmed.slice(0, separator).trim();
    const value = trimmed
      .slice(separator + 1)
      .trim()
      .replace(/^['"]|['"]$/g, "");
    if (!key || !value) continue;
    result[key] = value;
  }

  return result;
}

function extractFirstFileUrl(body: string): string | undefined {
  const match = body.match(/^\s*-\s*url:\s*["']?([^"'\n]+)["']?\s*$/m);
  return match?.[1]?.trim();
}

function resolveArtifactUrl(sourceBaseUrl: unknown, artifactPath: string): string {
  if (/^https?:\/\//i.test(artifactPath)) return artifactPath;
  if (typeof sourceBaseUrl !== "string" || sourceBaseUrl.length === 0) return artifactPath;
  const normalizedBase = sourceBaseUrl.endsWith("/") ? sourceBaseUrl : `${sourceBaseUrl}/`;
  return `${normalizedBase}${artifactPath.replace(/^\/+/, "")}`;
}

function inferArtifactType(path: string): ParsedArtifact["type"] {
  const lower = path.toLowerCase();
  if (lower.endsWith(".zip")) return "zip";
  if (lower.endsWith(".dmg")) return "dmg";
  if (lower.endsWith(".pkg")) return "pkg";
  return "other";
}

function parsePositiveInt(value: string): number | undefined {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
}
