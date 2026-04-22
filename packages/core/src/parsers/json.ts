import { JSONPath } from "jsonpath-plus";

import { inferChannel, isPreRelease } from "../versioning";
import type { ParsedArtifact, ParsedRelease, ParserOutput, SourceParser } from "./types";
import { inferArchitectureFromText, inferArtifactType, resolveUrl } from "./utils";

interface ArtifactExtractionConfig {
  artifactsPath: string;
  artifactUrlPath: string;
  architecturePath: string;
  sha256Path: string;
  sizeBytesPath: string;
  minOsVersionPath: string;
}

function queryJsonPath(path: string, json: object): unknown[] {
  // eslint-disable-next-line @typescript-eslint/no-unsafe-return
  return JSONPath({ path, json, wrap: true });
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
    const artifactConfig: ArtifactExtractionConfig = {
      artifactsPath: typeof config?.artifactsPath === "string" ? config.artifactsPath : "",
      artifactUrlPath: typeof config?.artifactUrlPath === "string" ? config.artifactUrlPath : "",
      architecturePath: typeof config?.architecturePath === "string" ? config.architecturePath : "",
      sha256Path: typeof config?.sha256Path === "string" ? config.sha256Path : "",
      sizeBytesPath: typeof config?.sizeBytesPath === "string" ? config.sizeBytesPath : "",
      minOsVersionPath: typeof config?.minOsVersionPath === "string" ? config.minOsVersionPath : "",
    };

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
      return parseMultiRelease(
        data,
        releasesPath,
        versionPath,
        downloadPath,
        artifactConfig,
        sourceBaseUrl,
      );
    }

    return parseSingleRelease(data, versionPath, downloadPath, artifactConfig, sourceBaseUrl);
  },
};

function parseSingleRelease(
  data: object,
  versionPath: string,
  downloadPath: string,
  artifactConfig: ArtifactExtractionConfig,
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

  const { artifacts, errors: artifactErrors } = extractArtifacts(
    data,
    downloadPath,
    artifactConfig,
    sourceBaseUrl,
  );
  errors.push(...artifactErrors);
  const downloadUrl = artifacts[0]?.url;

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
  artifactConfig: ArtifactExtractionConfig,
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
      const results = queryJsonPath(versionPath, element);
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

    const extracted = extractArtifacts(
      element,
      downloadPath,
      artifactConfig,
      sourceBaseUrl,
      `element [${i}]`,
    );
    errors.push(...extracted.errors);
    const artifacts = extracted.artifacts;
    const downloadUrl = artifacts[0]?.url;
    if (artifacts.length > 0) hasArtifacts = true;

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

function firstString(path: string, data: object): string | undefined {
  if (!path) return undefined;
  const first = queryJsonPath(path, data)[0];
  if (first === undefined || first === null) return undefined;
  const value = String(first).trim();
  return value || undefined;
}

function firstNumber(path: string, data: object): number | undefined {
  const value = firstString(path, data);
  if (!value) return undefined;
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
}

function makeArtifact(
  data: object,
  urlPath: string,
  config: ArtifactExtractionConfig,
  sourceBaseUrl: string,
): ParsedArtifact | undefined {
  const rawUrl = firstString(urlPath, data);
  if (!rawUrl) return undefined;
  const url = resolveUrl(rawUrl, sourceBaseUrl);
  return {
    url,
    type: inferArtifactType(url),
    architecture: inferArchitectureFromText(firstString(config.architecturePath, data) ?? rawUrl),
    sha256: firstString(config.sha256Path, data),
    sizeBytes: firstNumber(config.sizeBytesPath, data),
    minOsVersion: firstString(config.minOsVersionPath, data),
  };
}

function extractArtifacts(
  data: object,
  downloadPath: string,
  config: ArtifactExtractionConfig,
  sourceBaseUrl: string,
  context = "JSON",
): { artifacts: ParsedArtifact[]; errors: string[] } {
  const errors: string[] = [];
  const artifacts: ParsedArtifact[] = [];

  try {
    if (config.artifactsPath) {
      const elements = queryJsonPath(config.artifactsPath, data);
      const artifactUrlPath = config.artifactUrlPath || "$.url";
      for (const element of elements) {
        if (typeof element !== "object" || element === null) continue;
        const artifact = makeArtifact(element, artifactUrlPath, config, sourceBaseUrl);
        if (artifact) artifacts.push(artifact);
      }
      return { artifacts, errors };
    }

    if (downloadPath) {
      const artifact = makeArtifact(data, downloadPath, config, sourceBaseUrl);
      if (artifact) artifacts.push(artifact);
    }
  } catch (e) {
    errors.push(
      `${context} artifact extraction failed: ${e instanceof Error ? e.message : String(e)}`,
    );
  }

  return { artifacts, errors };
}
