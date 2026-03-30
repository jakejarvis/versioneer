import { JSONPath } from "jsonpath-plus";

import { inferChannel, isPreRelease } from "../versioning";
import type { ParsedArtifact, ParsedRelease, ParserOutput, SourceParser } from "./types";
import { inferArtifactType, resolveUrl } from "./utils";

function queryJsonPath(path: string, json: object): unknown[] {
  // eslint-disable-next-line @typescript-eslint/no-unsafe-return
  return JSONPath({ path, json, wrap: true }) as never;
}

export const jsonParser: SourceParser = {
  key: "json",
  version: "1.1.0",

  parse(body: string, config?: Record<string, unknown>): ParserOutput {
    const errors: string[] = [];

    const releasesPath = typeof config?.releasesPath === "string" ? config.releasesPath : "";
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

    if (releasesPath) {
      return parseMultiRelease(data, releasesPath, versionPath, downloadPath, sourceBaseUrl);
    }

    return parseSingleRelease(data, versionPath, downloadPath, sourceBaseUrl);
  },
};

function parseSingleRelease(
  data: object,
  versionPath: string,
  downloadPath: string,
  sourceBaseUrl: string,
): ParserOutput {
  const errors: string[] = [];

  let versionRaw: string;
  try {
    const results = queryJsonPath(versionPath, data);
    const first = results[0];
    if (first === undefined || first === null) {
      errors.push(`versionPath "${versionPath}" matched no value in the JSON`);
      return { releases: [], confidence: 0, parserVersion: jsonParser.version, errors };
    }
    versionRaw = String(first).trim();
  } catch (e) {
    errors.push(
      `Invalid versionPath JSONPath expression: ${e instanceof Error ? e.message : String(e)}`,
    );
    return { releases: [], confidence: 0, parserVersion: jsonParser.version, errors };
  }

  if (!versionRaw) {
    errors.push("versionPath matched but resolved to an empty string");
    return { releases: [], confidence: 0, parserVersion: jsonParser.version, errors };
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
}

function parseMultiRelease(
  data: object,
  releasesPath: string,
  versionPath: string,
  downloadPath: string,
  sourceBaseUrl: string,
): ParserOutput {
  const errors: string[] = [];
  const releases: ParsedRelease[] = [];

  let elements: unknown[];
  try {
    elements = queryJsonPath(releasesPath, data);
  } catch (e) {
    errors.push(
      `Invalid releasesPath JSONPath expression: ${e instanceof Error ? e.message : String(e)}`,
    );
    return { releases: [], confidence: 0, parserVersion: jsonParser.version, errors };
  }

  if (elements.length === 0) {
    errors.push(`releasesPath "${releasesPath}" matched no elements in the JSON`);
    return { releases: [], confidence: 0, parserVersion: jsonParser.version, errors };
  }

  let hasArtifacts = false;

  for (let i = 0; i < elements.length; i++) {
    const element = elements[i];
    if (typeof element !== "object" || element === null) {
      errors.push(`releasesPath element [${i}] is not an object`);
      continue;
    }

    let versionRaw: string;
    try {
      const results = queryJsonPath(versionPath, element as object);
      const first = results[0];
      if (first === undefined || first === null) {
        errors.push(`versionPath "${versionPath}" matched no value in element [${i}]`);
        continue;
      }
      versionRaw = String(first).trim();
    } catch (e) {
      errors.push(
        `versionPath failed on element [${i}]: ${e instanceof Error ? e.message : String(e)}`,
      );
      continue;
    }

    if (!versionRaw) {
      errors.push(`versionPath matched but resolved to empty string in element [${i}]`);
      continue;
    }

    let downloadUrl: string | undefined;
    const artifacts: ParsedArtifact[] = [];
    if (downloadPath) {
      try {
        const results = queryJsonPath(downloadPath, element as object);
        const first = results[0];
        if (first !== undefined && first !== null) {
          const rawUrl = String(first).trim();
          if (rawUrl) {
            downloadUrl = resolveUrl(rawUrl, sourceBaseUrl);
            artifacts.push({
              url: downloadUrl,
              type: inferArtifactType(downloadUrl),
            });
            hasArtifacts = true;
          }
        }
      } catch (e) {
        errors.push(
          `downloadPath failed on element [${i}]: ${e instanceof Error ? e.message : String(e)}`,
        );
      }
    }

    releases.push({
      versionRaw,
      channel: inferChannel(versionRaw),
      isPrerelease: isPreRelease(versionRaw),
      downloadUrl,
      artifacts,
      metadata: {
        releasesPath,
        versionPath,
        downloadPath: downloadPath || null,
      },
    });
  }

  return {
    releases,
    confidence: hasArtifacts ? 70 : 50,
    parserVersion: jsonParser.version,
    errors,
  };
}
