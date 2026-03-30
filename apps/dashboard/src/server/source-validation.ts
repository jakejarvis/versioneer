import { createServerFn } from "@tanstack/react-start";
import {
  sparkleParser,
  githubReleasesParser,
  homebrewCaskParser,
  macAppStoreParser,
  electronGenericParser,
} from "@versioneer/core/parsers";
import {
  githubApiHeaders,
  readResponseTextLimited,
  ResponseBodyTooLargeError,
} from "@versioneer/core/pipeline";
import { env } from "cloudflare:workers";
import { z } from "zod";

const MAX_VALIDATION_BODY_BYTES = 2 * 1024 * 1024;

export const validateSource = createServerFn({ method: "POST" })
  .inputValidator(
    z.object({
      url: z.string().url(),
      sourceType: z.enum([
        "sparkle",
        "github_releases",
        "homebrew_cask",
        "mac_app_store",
        "electron_generic",
        "web_page",
      ]),
    }),
  )
  .handler(async ({ data }) => {
    const { url, sourceType } = data;
    const fetchUrl = sourceType === "electron_generic" ? resolveElectronFeedUrl(url) : url;

    let response: Response;
    try {
      const headers: Record<string, string> =
        sourceType === "github_releases" ? githubApiHeaders(env.GITHUB_TOKEN) : {};
      response = await fetch(fetchUrl, {
        signal: AbortSignal.timeout(10_000),
        headers,
      });
    } catch {
      return {
        status: "timeout" as const,
        releaseCount: 0,
        latestVersion: null,
        latestPublishedAt: null,
        errors: ["Request timed out"],
        releases: [],
      };
    }

    if (!response.ok) {
      return {
        status: "invalid" as const,
        releaseCount: 0,
        latestVersion: null,
        latestPublishedAt: null,
        errors: [`HTTP ${response.status}: ${response.statusText}`],
        releases: [],
      };
    }

    let body: string;
    try {
      ({ text: body } = await readResponseTextLimited(response, MAX_VALIDATION_BODY_BYTES));
    } catch (error) {
      if (error instanceof ResponseBodyTooLargeError) {
        return {
          status: "invalid" as const,
          releaseCount: 0,
          latestVersion: null,
          latestPublishedAt: null,
          errors: [error.message],
          releases: [],
        };
      }
      throw error;
    }
    const parser =
      sourceType === "sparkle"
        ? sparkleParser
        : sourceType === "homebrew_cask"
          ? homebrewCaskParser
          : sourceType === "mac_app_store"
            ? macAppStoreParser
            : sourceType === "electron_generic"
              ? electronGenericParser
              : githubReleasesParser;
    const parsed = parser.parse(
      body,
      sourceType === "electron_generic" ? { sourceBaseUrl: url } : undefined,
    );

    if (parsed.releases.length === 0) {
      return {
        status: "invalid" as const,
        releaseCount: 0,
        latestVersion: null,
        latestPublishedAt: null,
        errors: parsed.errors.length > 0 ? parsed.errors : ["No releases found"],
        releases: [],
      };
    }

    const latest =
      parsed.releases.find((r) => r.channel === "stable" && !r.isPrerelease) ?? parsed.releases[0];

    return {
      status: "valid" as const,
      releaseCount: parsed.releases.length,
      latestVersion: latest?.versionRaw ?? null,
      latestPublishedAt: latest?.publishedAt ?? null,
      errors: parsed.errors,
      releases: parsed.releases.slice(0, 5).map((r) => ({
        version: r.versionRaw,
        publishedAt: r.publishedAt ?? null,
        artifactCount: r.artifacts.length,
        channel: r.channel,
      })),
    };
  });

function resolveElectronFeedUrl(url: string): string {
  if (url.endsWith("latest-mac.yml") || url.endsWith("latest.yml")) return url;
  const normalized = url.endsWith("/") ? url : `${url}/`;
  return `${normalized}latest-mac.yml`;
}
