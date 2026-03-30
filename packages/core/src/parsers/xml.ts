import { DOMParser } from "@xmldom/xmldom";
import xpath from "xpath";

import { inferChannel, isPreRelease } from "../versioning";
import type { ParsedArtifact, ParsedRelease, ParserOutput, SourceParser } from "./types";
import { inferArtifactType, resolveUrl } from "./utils";

// xmldom's Document is structurally compatible with the global DOM Document
// that xpath expects, but TS sees them as distinct nominal types.
const noop = () => {};

export const xmlParser: SourceParser = {
  key: "xml",
  version: "1.1.0",

  parse(body: string, config?: Record<string, unknown>): ParserOutput {
    const errors: string[] = [];

    const releasesXPath = typeof config?.releasesXPath === "string" ? config.releasesXPath : "";
    const versionXPath = typeof config?.versionXPath === "string" ? config.versionXPath : "";
    const downloadXPath = typeof config?.downloadXPath === "string" ? config.downloadXPath : "";
    const sourceBaseUrl = typeof config?.sourceBaseUrl === "string" ? config.sourceBaseUrl : "";

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
      return parseMultiRelease(doc, releasesXPath, versionXPath, downloadXPath, sourceBaseUrl);
    }

    return parseSingleRelease(doc, versionXPath, downloadXPath, sourceBaseUrl);
  },
};

function parseSingleRelease(
  doc: Node,
  versionXPath: string,
  downloadXPath: string,
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

  let downloadUrl: string | undefined;
  const artifacts: ParsedArtifact[] = [];
  if (downloadXPath) {
    try {
      const result = xpath.select1(downloadXPath, doc);
      const text = nodeText(result);
      if (text !== null) {
        const rawUrl = text.trim();
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
        `Invalid downloadXPath expression: ${e instanceof Error ? e.message : String(e)}`,
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
    nodes = result as Node[];
  } catch (e) {
    errors.push(
      `Invalid releasesXPath expression: ${e instanceof Error ? e.message : String(e)}`,
    );
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

    let downloadUrl: string | undefined;
    const artifacts: ParsedArtifact[] = [];
    if (downloadXPath) {
      try {
        const result = xpath.select1(downloadXPath, node);
        const text = nodeText(result);
        if (text !== null) {
          const rawUrl = text.trim();
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
          `downloadXPath failed on element [${i}]: ${e instanceof Error ? e.message : String(e)}`,
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
