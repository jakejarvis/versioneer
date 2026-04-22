import { DOMParser } from "@xmldom/xmldom";
import xpath from "xpath";

import { inferChannel, isPreRelease } from "../versioning";
import type { ParsedArtifact, ParsedRelease, ParserOutput, SourceParser } from "./types";
import { inferArchitectureFromText, inferArtifactType, resolveUrl } from "./utils";

// xmldom's Document is structurally compatible with the global DOM Document
// that xpath expects, but TS sees them as distinct nominal types.
const noop = () => {};

interface ArtifactExtractionConfig {
  artifactsXPath: string;
  artifactUrlXPath: string;
  architectureXPath: string;
  sha256XPath: string;
  sizeBytesXPath: string;
  minOsVersionXPath: string;
}

export const xmlParser: SourceParser = {
  key: "xml",
  version: "1.1.0",

  parse(body: string, config?: Record<string, unknown>): ParserOutput {
    const errors: string[] = [];

    const releasesXPath = typeof config?.releasesXPath === "string" ? config.releasesXPath : "";
    const versionXPath = typeof config?.versionXPath === "string" ? config.versionXPath : "";
    const downloadXPath = typeof config?.downloadXPath === "string" ? config.downloadXPath : "";
    const sourceBaseUrl = typeof config?.sourceBaseUrl === "string" ? config.sourceBaseUrl : "";
    const artifactConfig: ArtifactExtractionConfig = {
      artifactsXPath: typeof config?.artifactsXPath === "string" ? config.artifactsXPath : "",
      artifactUrlXPath: typeof config?.artifactUrlXPath === "string" ? config.artifactUrlXPath : "",
      architectureXPath:
        typeof config?.architectureXPath === "string" ? config.architectureXPath : "",
      sha256XPath: typeof config?.sha256XPath === "string" ? config.sha256XPath : "",
      sizeBytesXPath: typeof config?.sizeBytesXPath === "string" ? config.sizeBytesXPath : "",
      minOsVersionXPath:
        typeof config?.minOsVersionXPath === "string" ? config.minOsVersionXPath : "",
    };

    if (!versionXPath) {
      errors.push("Missing required config: versionXPath");
      return { releases: [], confidence: 0, parserVersion: this.version, errors };
    }

    let doc: Node;
    try {
      const parsed = new DOMParser({
        errorHandler: noop,
      }).parseFromString(body, "text/xml");
      doc = parsed as unknown as Node;
    } catch (e) {
      errors.push(`Failed to parse XML: ${e instanceof Error ? e.message : String(e)}`);
      return { releases: [], confidence: 0, parserVersion: this.version, errors };
    }

    if (releasesXPath) {
      return parseMultiRelease(
        doc,
        releasesXPath,
        versionXPath,
        downloadXPath,
        artifactConfig,
        sourceBaseUrl,
      );
    }

    return parseSingleRelease(doc, versionXPath, downloadXPath, artifactConfig, sourceBaseUrl);
  },
};

function parseSingleRelease(
  doc: Node,
  versionXPath: string,
  downloadXPath: string,
  artifactConfig: ArtifactExtractionConfig,
  sourceBaseUrl: string,
): ParserOutput {
  const errors: string[] = [];

  let versionRaw: string;
  try {
    const result = xpath.select1(versionXPath, doc);
    const text = nodeText(result);
    if (text === null) {
      errors.push(`versionXPath "${versionXPath}" matched no value in the XML`);
      return { releases: [], confidence: 0, parserVersion: xmlParser.version, errors };
    }
    versionRaw = text.trim();
  } catch (e) {
    errors.push(`Invalid versionXPath expression: ${e instanceof Error ? e.message : String(e)}`);
    return { releases: [], confidence: 0, parserVersion: xmlParser.version, errors };
  }

  if (!versionRaw) {
    errors.push("versionXPath matched but resolved to an empty string");
    return { releases: [], confidence: 0, parserVersion: xmlParser.version, errors };
  }

  const extracted = extractArtifacts(doc, downloadXPath, artifactConfig, sourceBaseUrl);
  errors.push(...extracted.errors);
  const artifacts = extracted.artifacts;
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
          versionXPath,
          downloadXPath: downloadXPath || null,
        },
      },
    ],
    confidence: artifacts.length > 0 ? 70 : 50,
    parserVersion: xmlParser.version,
    errors,
  };
}

function parseMultiRelease(
  doc: Node,
  releasesXPath: string,
  versionXPath: string,
  downloadXPath: string,
  artifactConfig: ArtifactExtractionConfig,
  sourceBaseUrl: string,
): ParserOutput {
  const errors: string[] = [];
  const releases: ParsedRelease[] = [];

  let nodes: Node[];
  try {
    const result = xpath.select(releasesXPath, doc);
    if (!Array.isArray(result)) {
      errors.push(`releasesXPath "${releasesXPath}" did not return a node set`);
      return { releases: [], confidence: 0, parserVersion: xmlParser.version, errors };
    }
    nodes = result;
  } catch (e) {
    errors.push(`Invalid releasesXPath expression: ${e instanceof Error ? e.message : String(e)}`);
    return { releases: [], confidence: 0, parserVersion: xmlParser.version, errors };
  }

  if (nodes.length === 0) {
    errors.push(`releasesXPath "${releasesXPath}" matched no elements in the XML`);
    return { releases: [], confidence: 0, parserVersion: xmlParser.version, errors };
  }

  let hasArtifacts = false;

  for (let i = 0; i < nodes.length; i++) {
    const node = nodes[i]!;

    let versionRaw: string;
    try {
      const result = xpath.select1(versionXPath, node);
      const text = nodeText(result);
      if (text === null) {
        errors.push(`versionXPath "${versionXPath}" matched no value in element [${i}]`);
        continue;
      }
      versionRaw = text.trim();
    } catch (e) {
      errors.push(
        `versionXPath failed on element [${i}]: ${e instanceof Error ? e.message : String(e)}`,
      );
      continue;
    }

    if (!versionRaw) {
      errors.push(`versionXPath matched but resolved to empty string in element [${i}]`);
      continue;
    }

    const extracted = extractArtifacts(
      node,
      downloadXPath,
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
        releasesXPath,
        versionXPath,
        downloadXPath: downloadXPath || null,
      },
    });
  }

  return {
    releases,
    confidence: hasArtifacts ? 70 : 50,
    parserVersion: xmlParser.version,
    errors,
  };
}

function firstText(path: string, node: Node): string | undefined {
  if (!path) return undefined;
  const value = nodeText(xpath.select1(path, node))?.trim();
  return value || undefined;
}

function firstNumber(path: string, node: Node): number | undefined {
  const value = firstText(path, node);
  if (!value) return undefined;
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
}

function makeArtifact(
  node: Node,
  urlXPath: string,
  config: ArtifactExtractionConfig,
  sourceBaseUrl: string,
): ParsedArtifact | undefined {
  const rawUrl = firstText(urlXPath, node);
  if (!rawUrl) return undefined;
  const url = resolveUrl(rawUrl, sourceBaseUrl);
  return {
    url,
    type: inferArtifactType(url),
    architecture: inferArchitectureFromText(firstText(config.architectureXPath, node) ?? rawUrl),
    sha256: firstText(config.sha256XPath, node),
    sizeBytes: firstNumber(config.sizeBytesXPath, node),
    minOsVersion: firstText(config.minOsVersionXPath, node),
  };
}

function extractArtifacts(
  node: Node,
  downloadXPath: string,
  config: ArtifactExtractionConfig,
  sourceBaseUrl: string,
  context = "XML",
): { artifacts: ParsedArtifact[]; errors: string[] } {
  const artifacts: ParsedArtifact[] = [];
  const errors: string[] = [];
  try {
    if (config.artifactsXPath) {
      const nodes = xpath.select(config.artifactsXPath, node);
      if (Array.isArray(nodes)) {
        const artifactUrlXPath = config.artifactUrlXPath || "./@url";
        for (const selected of nodes) {
          if (
            typeof selected === "string" ||
            typeof selected === "number" ||
            typeof selected === "boolean"
          ) {
            continue;
          }
          const artifact = makeArtifact(selected as Node, artifactUrlXPath, config, sourceBaseUrl);
          if (artifact) artifacts.push(artifact);
        }
      }
      return { artifacts, errors };
    }

    if (downloadXPath) {
      const artifact = makeArtifact(node, downloadXPath, config, sourceBaseUrl);
      if (artifact) artifacts.push(artifact);
    }
  } catch (e) {
    errors.push(
      `${context} artifact extraction failed: ${e instanceof Error ? e.message : String(e)}`,
    );
  }
  return { artifacts, errors };
}

/** Extract text content from an xpath result (element, attribute, or text node). */
function nodeText(result: xpath.SelectedValue | undefined): string | null {
  if (result === undefined || result === null) return null;
  if (typeof result === "string") return result;
  if (typeof result === "number" || typeof result === "boolean") return String(result);

  const node = result as { textContent?: string | null; nodeValue?: string | null };
  if (typeof node.nodeValue === "string") return node.nodeValue;
  if (typeof node.textContent === "string") return node.textContent;

  return null;
}
