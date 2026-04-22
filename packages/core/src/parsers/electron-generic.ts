import { inferChannel, isPreRelease } from "../versioning";
import type { ParsedArtifact, ParsedRelease, ParserOutput, SourceParser } from "./types";
import { inferArchitectureFromText, inferArtifactType } from "./utils";

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

      const fileArtifacts = extractFileArtifacts(body, config?.sourceBaseUrl);
      const artifactPath = yaml.path ?? yaml.url ?? extractFirstFileUrl(body);
      const artifacts: ParsedArtifact[] =
        fileArtifacts.length > 0
          ? fileArtifacts
          : artifactPath
            ? [
                {
                  url: resolveArtifactUrl(config?.sourceBaseUrl, artifactPath),
                  type: inferArtifactType(artifactPath),
                  architecture: inferArchitectureFromText(artifactPath),
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
        artifacts,
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

function extractFileArtifacts(body: string, sourceBaseUrl: unknown): ParsedArtifact[] {
  const filesBlock = extractFilesBlock(body);
  if (!filesBlock) return [];

  const artifacts: ParsedArtifact[] = [];
  const blocks = filesBlock
    .split(/\n(?=\s*-\s+url:\s*)/)
    .map((block) => block.trim())
    .filter(Boolean);

  for (const block of blocks) {
    const url = block.match(/^-\s+url:\s*["']?([^"'\n]+)["']?/m)?.[1]?.trim();
    if (!url) continue;
    const sha512 = block.match(/^\s*sha512:\s*["']?([^"'\n]+)["']?/m)?.[1]?.trim();
    const size = block.match(/^\s*size:\s*["']?([^"'\n]+)["']?/m)?.[1]?.trim();
    artifacts.push({
      url: resolveArtifactUrl(sourceBaseUrl, url),
      type: inferArtifactType(url),
      architecture: inferArchitectureFromText(url),
      signature: sha512,
      sizeBytes: size ? parsePositiveInt(size) : undefined,
    });
  }

  return artifacts;
}

function extractFilesBlock(body: string): string | undefined {
  const lines = body.split(/\r?\n/);
  const block: string[] = [];
  let inFiles = false;

  for (const line of lines) {
    if (!inFiles) {
      if (/^\s*files:\s*$/.test(line)) inFiles = true;
      continue;
    }

    if (/^\S/.test(line) && line.includes(":")) break;
    block.push(line);
  }

  return block.length > 0 ? block.join("\n") : undefined;
}

function resolveArtifactUrl(sourceBaseUrl: unknown, artifactPath: string): string {
  if (/^https?:\/\//i.test(artifactPath)) return artifactPath;
  if (typeof sourceBaseUrl !== "string" || sourceBaseUrl.length === 0) return artifactPath;
  const normalizedBase = sourceBaseUrl.endsWith("/") ? sourceBaseUrl : `${sourceBaseUrl}/`;
  return `${normalizedBase}${artifactPath.replace(/^\/+/, "")}`;
}

function parsePositiveInt(value: string): number | undefined {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
}
