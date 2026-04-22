import { inferChannel, isPreRelease } from "../versioning";
import type { SourceParser, ParserOutput, ParsedRelease, ParsedArtifact } from "./types";
import { inferArchitectureFromText } from "./utils";

/**
 * Minimal XML-like parser for Sparkle appcast feeds.
 * Sparkle uses RSS-like XML with sparkle: namespace.
 */
export const sparkleParser: SourceParser = {
  key: "sparkle",
  version: "1.2.0",

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
  const releaseNotesBody = extractDescription(xml);

  // Explicit Sparkle channel tag (e.g. "beta") overrides version-string inference
  const sparkleChannel = extractTag(xml, "sparkle:channel");

  const itemMinOsVersion = extractTag(xml, "sparkle:minimumSystemVersion");
  const artifacts = extractEnclosureArtifacts(xml, itemMinOsVersion);
  if (hasEnclosures(xml) && artifacts.length === 0) return null;

  const downloadUrl = artifacts[0]?.url;

  return {
    versionRaw: version,
    buildNumber: buildNumber !== version ? (buildNumber ?? undefined) : undefined,
    channel: sparkleChannel ?? inferChannel(version),
    isPrerelease: isPreRelease(version),
    publishedAt: publishedAt ?? undefined,
    releaseNotesUrl: releaseNotesUrl ?? undefined,
    releaseNotesBody: releaseNotesBody ?? undefined,
    releaseNotesFormat: releaseNotesBody ? ("html" as const) : undefined,
    downloadUrl: downloadUrl ?? undefined,
    artifacts,
  };
}

function hasEnclosures(xml: string): boolean {
  return /<enclosure\s/i.test(xml);
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

function extractEnclosureArtifacts(xml: string, itemMinOsVersion: string | null): ParsedArtifact[] {
  const artifacts: ParsedArtifact[] = [];
  const enclosureRegex = /<enclosure\s([^>]*?)\/?\s*>/gi;
  let match: RegExpExecArray | null;

  while ((match = enclosureRegex.exec(xml)) !== null) {
    const attrs = match[1]!;
    if (extractAttrValue(attrs, "sparkle:deltaFrom")) continue;

    const url = extractAttrValue(attrs, "url");
    if (!url) continue;

    const artifact: ParsedArtifact = {
      url,
      type: inferArtifactType(url),
      architecture:
        inferArchitectureFromText(extractAttrValue(attrs, "sparkle:architecture")) ??
        inferArchitectureFromText(url),
    };

    const length = extractAttrValue(attrs, "length");
    if (length) {
      const sizeBytes = parseInt(length, 10);
      if (!Number.isNaN(sizeBytes) && sizeBytes > 0) artifact.sizeBytes = sizeBytes;
    }

    const signature =
      extractAttrValue(attrs, "sparkle:edSignature") ??
      extractAttrValue(attrs, "sparkle:dsaSignature");
    if (signature) artifact.signature = signature;

    const osVersion = extractAttrValue(attrs, "sparkle:minimumSystemVersion") ?? itemMinOsVersion;
    if (osVersion) artifact.minOsVersion = osVersion;

    artifacts.push(artifact);
  }

  return artifacts;
}

function extractAttrValue(attrs: string, name: string): string | null {
  const match = attrs.match(new RegExp(`${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)')`, "i"));
  return match?.[1] ?? match?.[2] ?? null;
}

function extractDescription(xml: string): string | null {
  // Handle CDATA-wrapped: <description><![CDATA[<h2>Notes</h2>...]]></description>
  const cdataMatch = xml.match(/<description[^>]*><!\[CDATA\[([\s\S]*?)\]\]><\/description>/i);
  if (cdataMatch?.[1]) return cdataMatch[1].trim();

  // Handle raw HTML: <description><h2>Notes</h2>...</description>
  const rawMatch = xml.match(/<description[^>]*>([\s\S]*?)<\/description>/i);
  if (rawMatch?.[1]) return rawMatch[1].trim();

  return null;
}

function inferArtifactType(url: string): ParsedArtifact["type"] {
  const lower = url.toLowerCase();
  if (lower.endsWith(".zip")) return "zip";
  if (lower.endsWith(".dmg")) return "dmg";
  if (lower.endsWith(".pkg")) return "pkg";
  return "appcast_enclosure";
}
