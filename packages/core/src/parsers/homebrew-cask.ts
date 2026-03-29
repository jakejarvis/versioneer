import { inferChannel, isPreRelease } from "../versioning";
import type { ParsedArtifact, ParsedRelease, ParserOutput, SourceParser } from "./types";

interface CaskJson {
  token: string;
  version: string;
  sha256: string;
  url: string;
  name?: string[];
  desc?: string;
  homepage?: string;
  container?: string | null;
  auto_updates?: boolean;
  depends_on?: {
    macos?: Record<string, string[]>;
  };
  variations?: Record<
    string,
    {
      url?: string;
      sha256?: string;
      version?: string;
    }
  >;
  artifacts?: unknown[];
}

export const homebrewCaskParser: SourceParser = {
  key: "homebrew_cask",
  version: "1.0.0",

  parse(body: string, _config?: Record<string, unknown>): ParserOutput {
    const errors: string[] = [];

    try {
      const cask = JSON.parse(body) as CaskJson;

      if (!cask.version || !cask.token) {
        errors.push("Missing version or token in cask JSON");
        return { releases: [], confidence: 0, parserVersion: this.version, errors };
      }

      // Homebrew uses "latest" for apps that self-update with no pinned version
      if (cask.version === "latest") {
        errors.push("Cask version is 'latest' (auto-updating app, no pinned version)");
        return { releases: [], confidence: 0, parserVersion: this.version, errors };
      }

      const versionRaw = cask.version.split(",")[0]!.trim();
      const channel = inferChannel(versionRaw);
      const artifacts: ParsedArtifact[] = [];

      // Primary artifact
      if (cask.url) {
        const sha256 = cask.sha256 !== "no_check" ? cask.sha256 : undefined;
        artifacts.push({
          url: cask.url,
          type: inferArtifactTypeFromUrl(cask.url, cask.container),
          sha256,
          architecture: inferArchitectureFromUrl(cask.url),
          minOsVersion: extractMinOsVersion(cask.depends_on),
        });
      }

      // Architecture variations (arm64, intel)
      if (cask.variations) {
        for (const [arch, variation] of Object.entries(cask.variations)) {
          if (!variation.url) continue;
          const archLabel = archFromVariationKey(arch);
          if (!archLabel) continue;
          // Skip if it's the same URL as the primary
          if (variation.url === cask.url) continue;

          const sha256 =
            variation.sha256 && variation.sha256 !== "no_check" ? variation.sha256 : undefined;
          artifacts.push({
            url: variation.url,
            type: inferArtifactTypeFromUrl(variation.url, cask.container),
            sha256,
            architecture: archLabel,
            minOsVersion: extractMinOsVersion(cask.depends_on),
          });
        }
      }

      const release: ParsedRelease = {
        versionRaw,
        channel,
        isPrerelease: isPreRelease(versionRaw),
        artifacts,
        metadata: {
          homebrewCaskToken: cask.token,
          autoUpdates: cask.auto_updates ?? false,
          homepage: cask.homepage,
        },
      };

      return {
        releases: [release],
        confidence: 80,
        parserVersion: homebrewCaskParser.version,
        errors,
      };
    } catch (e) {
      errors.push(`Failed to parse cask JSON: ${e instanceof Error ? e.message : String(e)}`);
      return { releases: [], confidence: 0, parserVersion: homebrewCaskParser.version, errors };
    }
  },
};

function inferArtifactTypeFromUrl(url: string, container?: string | null): ParsedArtifact["type"] {
  // Explicit container type takes precedence
  if (container) {
    const c = container.toLowerCase();
    if (c === "dmg" || c.includes("dmg")) return "dmg";
    if (c === "zip" || c.includes("zip")) return "zip";
    if (c === "pkg" || c.includes("pkg")) return "pkg";
  }

  const lower = url.toLowerCase().split("?")[0] ?? "";
  if (lower.endsWith(".dmg")) return "dmg";
  if (lower.endsWith(".zip")) return "zip";
  if (lower.endsWith(".pkg")) return "pkg";
  if (lower.endsWith(".app.zip")) return "zip";
  return "other";
}

function inferArchitectureFromUrl(url: string): string | undefined {
  const lower = url.toLowerCase();
  if (lower.includes("arm64") || lower.includes("aarch64") || lower.includes("apple-silicon"))
    return "arm64";
  if (lower.includes("x86_64") || lower.includes("amd64") || lower.includes("intel"))
    return "x86_64";
  if (lower.includes("universal")) return "universal";
  return undefined;
}

function archFromVariationKey(key: string): string | undefined {
  const lower = key.toLowerCase();
  if (lower.includes("arm64") || lower.includes("silicon")) return "arm64";
  if (lower.includes("intel") || lower.includes("x86_64")) return "x86_64";
  return undefined;
}

function extractMinOsVersion(dependsOn?: CaskJson["depends_on"]): string | undefined {
  if (!dependsOn?.macos) return undefined;

  // macos field is like { ">=": ["12"] } or { ">=": ["ventura"] }
  const entries = Object.entries(dependsOn.macos);
  for (const [_op, versions] of entries) {
    if (Array.isArray(versions) && versions.length > 0) {
      return versions[0];
    }
  }
  return undefined;
}
