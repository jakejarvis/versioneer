import { inferChannel, isPreRelease } from "../versioning";
import type { ParsedArtifact, ParserOutput, SourceParser } from "./types";
import { inferArtifactType, resolveUrl } from "./utils";

export const regexParser: SourceParser = {
  key: "regex",
  version: "1.0.0",

  parse(body: string, config?: Record<string, unknown>): ParserOutput {
    const errors: string[] = [];

    const versionPattern = typeof config?.versionPattern === "string" ? config.versionPattern : "";
    const downloadPattern =
      typeof config?.downloadPattern === "string" ? config.downloadPattern : "";
    const flags = typeof config?.flags === "string" ? config.flags : "";
    const sourceBaseUrl = typeof config?.sourceBaseUrl === "string" ? config.sourceBaseUrl : "";

    if (!versionPattern) {
      errors.push("Missing required config: versionPattern");
      return { releases: [], confidence: 0, parserVersion: this.version, errors };
    }

    if (!body || body.trim().length === 0) {
      errors.push("Response body is empty");
      return { releases: [], confidence: 0, parserVersion: this.version, errors };
    }

    let versionRegex: RegExp;
    try {
      versionRegex = new RegExp(versionPattern, flags);
    } catch (e) {
      errors.push(`Invalid versionPattern regex: ${e instanceof Error ? e.message : String(e)}`);
      return { releases: [], confidence: 0, parserVersion: this.version, errors };
    }

    let downloadRegex: RegExp | null = null;
    if (downloadPattern) {
      try {
        downloadRegex = new RegExp(downloadPattern, flags);
      } catch (e) {
        errors.push(`Invalid downloadPattern regex: ${e instanceof Error ? e.message : String(e)}`);
        return { releases: [], confidence: 0, parserVersion: this.version, errors };
      }
    }

    const versionMatch = versionRegex.exec(body);
    if (!versionMatch) {
      errors.push(`versionPattern "${versionPattern}" did not match response body`);
      return { releases: [], confidence: 0, parserVersion: this.version, errors };
    }

    const versionRaw = (versionMatch[1] ?? versionMatch[0] ?? "").trim();
    if (!versionRaw) {
      errors.push("versionPattern matched but captured an empty string");
      return { releases: [], confidence: 0, parserVersion: this.version, errors };
    }

    let downloadUrl: string | undefined;
    const artifacts: ParsedArtifact[] = [];
    if (downloadRegex) {
      const downloadMatch = downloadRegex.exec(body);
      if (downloadMatch) {
        const rawUrl = (downloadMatch[1] ?? downloadMatch[0] ?? "").trim();
        if (rawUrl) {
          downloadUrl = resolveUrl(rawUrl, sourceBaseUrl);
          artifacts.push({
            url: downloadUrl,
            type: inferArtifactType(downloadUrl),
          });
        }
      }
    }

    return {
      releases: [
        {
          versionRaw,
          channel: inferChannel(versionRaw),
          isPrerelease: isPreRelease(versionRaw),
          downloadUrl,
          artifacts,
          metadata: {
            versionPattern,
            downloadPattern: downloadPattern || null,
            flags: flags || null,
          },
        },
      ],
      confidence: artifacts.length > 0 ? 60 : 40,
      parserVersion: regexParser.version,
      errors,
    };
  },
};
