import { createServerFn } from "@tanstack/react-start";
import { env } from "cloudflare:workers";
import { z } from "zod";

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
  fetchSourceUrl,
  isGitHubApiUrl,
  readResponseTextLimited,
  resolvePublicDnsAddresses,
  ResponseBodyTooLargeError,
  SourceUrlPolicyError,
} from "@versioneer/core/pipeline";
import { getDescriptor } from "@versioneer/core/sources";
import type { SourceType } from "@versioneer/schemas/sources";
import { sourceTypeSchema } from "@versioneer/schemas/sources";

import { captureAdminEvent, captureAdminException } from "./analytics";
import { authMiddleware } from "./middleware";

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
  .middleware([authMiddleware])
  .inputValidator(
    z.object({
      url: z.string().url(),
      sourceType: sourceTypeSchema,
      configJson: z.string().max(10_000).optional(),
    }),
  )
  .handler(async ({ data, context }) => {
    const { url, sourceType } = data;

    const parser = validatableParsers[sourceType];
    if (!parser) {
      return {
        status: "error" as const,
        releaseCount: 0,
        latestVersion: null,
        latestPublishedAt: null,
        errors: [`Source type "${sourceType}" does not support validation`],
        releases: [],
      };
    }

    const descriptor = getDescriptor(sourceType);
    const fetchUrls = descriptor.buildFetchUrls(url);

    let response: Response | undefined;
    let fetchedUrl: string | undefined;
    try {
      for (const candidate of fetchUrls) {
        fetchedUrl = candidate;
        const headers = descriptor.fetchHeaders({
          githubToken: isGitHubApiUrl(candidate) ? env.GITHUB_TOKEN : undefined,
        });
        const { response: res, url: finalUrl } = await fetchSourceUrl(
          candidate,
          {
            signal: AbortSignal.timeout(10_000),
            headers,
          },
          { resolveAddresses: resolvePublicDnsAddresses },
        );
        fetchedUrl = finalUrl.toString();
        if (res.ok) {
          response = res;
          break;
        }
        response = res;
      }
    } catch (error) {
      await captureAdminException(context.user, error, {
        flow: "source_validation",
        source_type: sourceType,
        status: "failed",
      });
      const isTimeout = error instanceof DOMException && error.name === "TimeoutError";
      const detail = isTimeout
        ? "Request timed out after 10 s"
        : error instanceof SourceUrlPolicyError
          ? error.message
          : error instanceof Error
            ? error.message
            : "Network error";
      return {
        status: "error" as const,
        releaseCount: 0,
        latestVersion: null,
        latestPublishedAt: null,
        errors: [fetchedUrl ? `${detail} (${fetchedUrl})` : detail],
        releases: [],
      };
    }

    if (!response?.ok) {
      const host = fetchedUrl ? new URL(fetchedUrl).host : url;
      return {
        status: "error" as const,
        releaseCount: 0,
        latestVersion: null,
        latestPublishedAt: null,
        errors: [
          response
            ? `${host} returned HTTP ${response.status} ${response.statusText}`.trim()
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
        await captureAdminEvent(context.user, "source_validation_failed", {
          target_type: "source",
          source_type: sourceType,
          status: "failed",
          error_name: "ResponseBodyTooLargeError",
        });
        return {
          status: "error" as const,
          releaseCount: 0,
          latestVersion: null,
          latestPublishedAt: null,
          errors: [error.message],
          releases: [],
        };
      }
      throw error;
    }

    const artifactBase = descriptor.resolveArtifactBase(url);
    let config: Record<string, unknown> = { sourceBaseUrl: artifactBase };
    if (data.configJson) {
      try {
        const parsed = JSON.parse(data.configJson) as Record<string, unknown>;
        config = { ...parsed, sourceBaseUrl: artifactBase };
      } catch {
        await captureAdminEvent(context.user, "source_validation_failed", {
          target_type: "source",
          source_type: sourceType,
          status: "failed",
          error_name: "ConfigJsonParseError",
        });
        return {
          status: "error" as const,
          releaseCount: 0,
          latestVersion: null,
          latestPublishedAt: null,
          errors: ["Config is not valid JSON"],
          releases: [],
        };
      }
    }

    const parsed = parser.parse(body, config);

    if (parsed.releases.length === 0) {
      const hint =
        parsed.errors.length > 0
          ? parsed.errors
          : [
              `${parser.key} parser found no releases — check that the URL returns the expected format`,
            ];
      await captureAdminEvent(context.user, "source_validation_failed", {
        target_type: "source",
        source_type: sourceType,
        status: "failed",
        error_count: hint.length,
      });
      return {
        status: "error" as const,
        releaseCount: 0,
        latestVersion: null,
        latestPublishedAt: null,
        errors: hint,
        releases: [],
      };
    }

    const latest =
      parsed.releases.find((r) => r.channel === "stable" && !r.isPrerelease) ?? parsed.releases[0];

    await captureAdminEvent(context.user, "source_validation_succeeded", {
      target_type: "source",
      source_type: sourceType,
      status: "valid",
      release_count: parsed.releases.length,
    });

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
