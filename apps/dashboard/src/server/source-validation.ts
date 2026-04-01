import { createServerFn } from "@tanstack/react-start";
import type { SourceParser } from "@versioneer/core/parsers";
import {
  sparkleParser,
  githubReleasesParser,
  homebrewCaskParser,
  macAppStoreParser,
  electronGenericParser,
  webPageParser,
  regexParser,
  jsonParser,
  xmlParser,
} from "@versioneer/core/parsers";
import {
  githubApiHeaders,
  readResponseTextLimited,
  ResponseBodyTooLargeError,
} from "@versioneer/core/pipeline";
import {
  buildElectronFeedCandidates,
  resolveElectronArtifactBase,
} from "@versioneer/core/validation";
import type { SourceType } from "@versioneer/schemas/sources";
import { sourceTypeSchema } from "@versioneer/schemas/sources";
import { env } from "cloudflare:workers";
import { z } from "zod";

const MAX_VALIDATION_BODY_BYTES = 2 * 1024 * 1024;

const validatableParsers: Partial<Record<SourceType, SourceParser>> = {
  sparkle: sparkleParser,
  github_releases: githubReleasesParser,
  homebrew_cask: homebrewCaskParser,
  mac_app_store: macAppStoreParser,
  electron_generic: electronGenericParser,
  web_page: webPageParser,
  regex: regexParser,
  json: jsonParser,
  xml: xmlParser,
};

export const validateSource = createServerFn({ method: "POST" })
  .inputValidator(
    z.object({
      url: z.string().url(),
      sourceType: sourceTypeSchema,
      configJson: z.string().max(10_000).optional(),
    }),
  )
  .handler(async ({ data }) => {
    const { url, sourceType } = data;

    const parser = validatableParsers[sourceType];
    if (!parser) {
      return {
        status: "invalid" as const,
        releaseCount: 0,
        latestVersion: null,
        latestPublishedAt: null,
        errors: [`Source type "${sourceType}" does not support validation`],
        releases: [],
      };
    }

    const fetchUrls =
      sourceType === "electron_generic" ? buildElectronFeedCandidates(url) : [url];

    let response: Response | undefined;
    try {
      const headers: Record<string, string> =
        sourceType === "github_releases" ? githubApiHeaders(env.GITHUB_TOKEN) : {};
      for (const candidate of fetchUrls) {
        const res = await fetch(candidate, {
          signal: AbortSignal.timeout(10_000),
          headers,
        });
        if (res.ok) {
          response = res;
          break;
        }
        response = res;
      }
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

    if (!response?.ok) {
      return {
        status: "invalid" as const,
        releaseCount: 0,
        latestVersion: null,
        latestPublishedAt: null,
        errors: [
          response
            ? `HTTP ${response.status}: ${response.statusText}`
            : "No candidate URLs to try",
        ],
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

    const artifactBase =
      sourceType === "electron_generic" ? resolveElectronArtifactBase(url) : url;
    let config: Record<string, unknown> = { sourceBaseUrl: artifactBase };
    if (data.configJson) {
      try {
        const parsed = JSON.parse(data.configJson) as Record<string, unknown>;
        config = { ...parsed, sourceBaseUrl: url };
      } catch {
        return {
          status: "invalid" as const,
          releaseCount: 0,
          latestVersion: null,
          latestPublishedAt: null,
          errors: ["Invalid configJson — must be valid JSON"],
          releases: [],
        };
      }
    }

    const parsed = parser.parse(body, config);

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

