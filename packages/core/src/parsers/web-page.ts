import * as cheerio from "cheerio";

import { inferChannel, isPreRelease } from "../versioning";
import type { ParsedArtifact, ParsedRelease, ParserOutput, SourceParser } from "./types";

export const webPageParser: SourceParser = {
  key: "web-page",
  version: "1.0.0",

  parse(body: string, config?: Record<string, unknown>): ParserOutput {
    const errors: string[] = [];

    const versionSelector =
      typeof config?.versionSelector === "string" ? config.versionSelector : "";
    const downloadSelector =
      typeof config?.downloadSelector === "string" ? config.downloadSelector : "";
    const versionPattern = typeof config?.versionPattern === "string" ? config.versionPattern : "";
    const sourceBaseUrl = typeof config?.sourceBaseUrl === "string" ? config.sourceBaseUrl : "";

    if (!versionSelector) {
      errors.push("Missing required config: versionSelector");
      return { releases: [], confidence: 0, parserVersion: this.version, errors };
    }
    if (!downloadSelector) {
      errors.push("Missing required config: downloadSelector");
      return { releases: [], confidence: 0, parserVersion: this.version, errors };
    }

    try {
      const $ = cheerio.load(body);

      // Extract version
      const versionEl = $(versionSelector).first();
      if (versionEl.length === 0) {
        errors.push(`No element matched versionSelector: ${versionSelector}`);
        return { releases: [], confidence: 0, parserVersion: this.version, errors };
      }

      let versionRaw = versionEl.text().trim();
      if (versionPattern) {
        const match = new RegExp(versionPattern).exec(versionRaw);
        if (match?.[1]) {
          versionRaw = match[1];
        } else if (match?.[0]) {
          versionRaw = match[0];
        } else {
          errors.push(`versionPattern "${versionPattern}" did not match text: "${versionRaw}"`);
          return { releases: [], confidence: 0, parserVersion: this.version, errors };
        }
      }

      if (!versionRaw) {
        errors.push("Version element matched but contained no text");
        return { releases: [], confidence: 0, parserVersion: this.version, errors };
      }

      // Extract download URLs
      const artifacts: ParsedArtifact[] = [];
      $(downloadSelector).each((_, el) => {
        const href = $(el).attr("href");
        if (!href) return;
        const url = resolveUrl(href, sourceBaseUrl);
        artifacts.push({
          url,
          type: inferArtifactType(url),
        });
      });

      const release: ParsedRelease = {
        versionRaw,
        channel: inferChannel(versionRaw),
        isPrerelease: isPreRelease(versionRaw),
        downloadUrl: artifacts[0]?.url,
        artifacts,
        metadata: {
          versionSelector,
          downloadSelector,
          sourceBaseUrl: sourceBaseUrl || null,
        },
      };

      return {
        releases: [release],
        confidence: artifacts.length > 0 ? 70 : 50,
        parserVersion: webPageParser.version,
        errors,
      };
    } catch (e) {
      errors.push(`Failed to parse web page: ${e instanceof Error ? e.message : String(e)}`);
      return { releases: [], confidence: 0, parserVersion: webPageParser.version, errors };
    }
  },
};

function resolveUrl(href: string, baseUrl: string): string {
  if (/^https?:\/\//i.test(href)) return href;
  if (!baseUrl) return href;
  try {
    return new URL(href, baseUrl).toString();
  } catch {
    return href;
  }
}

function inferArtifactType(url: string): ParsedArtifact["type"] {
  const lower = url.toLowerCase().split("?")[0] ?? "";
  if (lower.endsWith(".dmg")) return "dmg";
  if (lower.endsWith(".zip")) return "zip";
  if (lower.endsWith(".pkg")) return "pkg";
  return "other";
}
