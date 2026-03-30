import { JSONPath } from "jsonpath-plus";

import { inferChannel, isPreRelease } from "../versioning";
import type { ParsedArtifact, ParserOutput, SourceParser } from "./types";
import { inferArtifactType, resolveUrl } from "./utils";

function queryJsonPath(path: string, json: object): unknown[] {
  // eslint-disable-next-line @typescript-eslint/no-unsafe-return
  return JSONPath({ path, json, wrap: true }) as never;
}

export const jsonParser: SourceParser = {
  key: "json",
  version: "1.0.0",

  parse(body: string, config?: Record<string, unknown>): ParserOutput {
    const errors: string[] = [];

    const versionPath = typeof config?.versionPath === "string" ? config.versionPath : "";
    const downloadPath = typeof config?.downloadPath === "string" ? config.downloadPath : "";
    const sourceBaseUrl = typeof config?.sourceBaseUrl === "string" ? config.sourceBaseUrl : "";

    if (!versionPath) {
      errors.push("Missing required config: versionPath");
      return { releases: [], confidence: 0, parserVersion: this.version, errors };
    }

    let data: object;
    try {
      data = JSON.parse(body) as object;
    } catch (e) {
      errors.push(`Failed to parse JSON: ${e instanceof Error ? e.message : String(e)}`);
      return { releases: [], confidence: 0, parserVersion: this.version, errors };
    }

    let versionRaw: string;
    try {
      const results = queryJsonPath(versionPath, data);
      const first = results[0];
      if (first === undefined || first === null) {
        errors.push(`versionPath "${versionPath}" matched no value in the JSON`);
        return { releases: [], confidence: 0, parserVersion: this.version, errors };
      }
      versionRaw = String(first).trim();
    } catch (e) {
      errors.push(
        `Invalid versionPath JSONPath expression: ${e instanceof Error ? e.message : String(e)}`,
      );
      return { releases: [], confidence: 0, parserVersion: this.version, errors };
    }

    if (!versionRaw) {
      errors.push("versionPath matched but resolved to an empty string");
      return { releases: [], confidence: 0, parserVersion: this.version, errors };
    }

    let downloadUrl: string | undefined;
    const artifacts: ParsedArtifact[] = [];
    if (downloadPath) {
      try {
        const results = queryJsonPath(downloadPath, data);
        const first = results[0];
        if (first !== undefined && first !== null) {
          const rawUrl = String(first).trim();
          if (rawUrl) {
            downloadUrl = resolveUrl(rawUrl, sourceBaseUrl);
            artifacts.push({
              url: downloadUrl,
              type: inferArtifactType(downloadUrl),
            });
          }
        }
      } catch (e) {
        errors.push(
          `Invalid downloadPath JSONPath expression: ${e instanceof Error ? e.message : String(e)}`,
        );
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
            versionPath,
            downloadPath: downloadPath || null,
          },
        },
      ],
      confidence: artifacts.length > 0 ? 70 : 50,
      parserVersion: jsonParser.version,
      errors,
    };
  },
};
