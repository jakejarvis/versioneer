import { createServerFn } from "@tanstack/react-start";
import { sparkleParser, githubReleasesParser, homebrewCaskParser } from "@versioneer/parsers";
import { githubApiHeaders } from "@versioneer/pipeline";
import { env } from "cloudflare:workers";
import { z } from "zod";

export const validateSource = createServerFn({ method: "POST" })
  .inputValidator(
    z.object({
      url: z.string().url(),
      sourceType: z.enum(["sparkle", "github_releases", "homebrew_cask"]),
    }),
  )
  .handler(async ({ data }) => {
    const { url, sourceType } = data;

    let response: Response;
    try {
      const headers: Record<string, string> =
        sourceType === "github_releases" ? githubApiHeaders(env.GITHUB_TOKEN) : {};
      response = await fetch(url, {
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

    const body = await response.text();
    const parser =
      sourceType === "sparkle"
        ? sparkleParser
        : sourceType === "homebrew_cask"
          ? homebrewCaskParser
          : githubReleasesParser;
    const parsed = parser.parse(body);

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
