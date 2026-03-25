import { inferChannel } from "@macupdater/versioning";

import type { SourceParser, ParserOutput, ParsedRelease, ParsedArtifact } from "./types";

/**
 * Minimal XML-like parser for Sparkle appcast feeds.
 * Sparkle uses RSS-like XML with sparkle: namespace.
 */
export const sparkleParser: SourceParser = {
  key: "sparkle",
  version: "1.0.0",

  parse(body: string, _config?: Record<string, unknown>): ParserOutput {
    const releases: ParsedRelease[] = [];
    const errors: string[] = [];

    try {
      // Extract <item> elements
      const itemRegex = /<item>([\s\S]*?)<\/item>/gi;
      let itemMatch;

      while ((itemMatch = itemRegex.exec(body)) !== null) {
        try {
          const itemXml = itemMatch[1]!;
          const release = parseSparkleItem(itemXml);
          if (release) {
            releases.push(release);
          }
        } catch (e) {
          errors.push(`Failed to parse item: ${e instanceof Error ? e.message : String(e)}`);
        }
      }
    } catch (e) {
      errors.push(`Failed to parse appcast: ${e instanceof Error ? e.message : String(e)}`);
    }

    return {
      releases,
      confidence: releases.length > 0 ? 90 : 0,
      parserVersion: sparkleParser.version,
      errors,
    };
  },
};

function parseSparkleItem(xml: string): ParsedRelease | null {
  const version =
    extractTag(xml, "sparkle:shortVersionString") ??
    extractTag(xml, "sparkle:version") ??
    extractAttr(xml, "enclosure", "sparkle:shortVersionString") ??
    extractAttr(xml, "enclosure", "sparkle:version");

  if (!version) return null;

  const buildNumber =
    extractTag(xml, "sparkle:version") ?? extractAttr(xml, "enclosure", "sparkle:version");

  const publishedAt = extractTag(xml, "pubDate");
  const releaseNotesUrl = extractTag(xml, "sparkle:releaseNotesLink");

  // Extract enclosure info
  const enclosureMatch = xml.match(/<enclosure\s([^>]*?)\/?\s*>/i);
  const artifacts: ParsedArtifact[] = [];

  if (enclosureMatch) {
    const encAttrs = enclosureMatch[1]!;
    const url = extractAttrValue(encAttrs, "url");
    if (url) {
      const artifact: ParsedArtifact = {
        url,
        type: inferArtifactType(url),
      };

      const length = extractAttrValue(encAttrs, "length");
      if (length) artifact.sizeBytes = parseInt(length, 10);

      const signature =
        extractAttrValue(encAttrs, "sparkle:edSignature") ??
        extractAttrValue(encAttrs, "sparkle:dsaSignature");
      if (signature) artifact.signature = signature;

      const osVersion =
        extractAttrValue(encAttrs, "sparkle:minimumSystemVersion") ??
        extractTag(xml, "sparkle:minimumSystemVersion");
      if (osVersion) artifact.minOsVersion = osVersion;

      artifacts.push(artifact);
    }
  }

  const downloadUrl = artifacts[0]?.url;

  return {
    versionRaw: version,
    buildNumber: buildNumber !== version ? (buildNumber ?? undefined) : undefined,
    channel: inferChannel(version),
    isPrerelease: /alpha|beta|rc|dev|canary|nightly/i.test(version),
    publishedAt: publishedAt ?? undefined,
    releaseNotesUrl: releaseNotesUrl ?? undefined,
    downloadUrl: downloadUrl ?? undefined,
    artifacts,
  };
}

function extractTag(xml: string, tag: string): string | null {
  // Handle both namespaced and non-namespaced, CDATA, etc.
  const patterns = [
    new RegExp(`<${tag}[^>]*><!\\[CDATA\\[([\\s\\S]*?)\\]\\]></${tag}>`, "i"),
    new RegExp(`<${tag}[^>]*>([^<]*)</${tag}>`, "i"),
  ];
  for (const pattern of patterns) {
    const match = xml.match(pattern);
    if (match?.[1]) return match[1].trim();
  }
  return null;
}

function extractAttr(xml: string, tag: string, attr: string): string | null {
  const tagMatch = xml.match(new RegExp(`<${tag}\\s([^>]*?)\\/?\\s*>`, "i"));
  if (!tagMatch) return null;
  return extractAttrValue(tagMatch[1]!, attr);
}

function extractAttrValue(attrs: string, name: string): string | null {
  const match = attrs.match(new RegExp(`${name}\\s*=\\s*"([^"]*)"`, "i"));
  return match?.[1] ?? null;
}

function inferArtifactType(url: string): ParsedArtifact["type"] {
  const lower = url.toLowerCase();
  if (lower.endsWith(".zip")) return "zip";
  if (lower.endsWith(".dmg")) return "dmg";
  if (lower.endsWith(".pkg")) return "pkg";
  return "appcast_enclosure";
}
