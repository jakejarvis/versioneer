import { parseGitHubRepoUrl } from "./github-url";

/**
 * Converts a type-specific source identifier into a fetchable URL.
 *
 * | Source Type        | Identifier example               | Resolved URL                                              |
 * |--------------------|----------------------------------|-----------------------------------------------------------|
 * | sparkle            | https://example.com/appcast.xml  | passthrough                                               |
 * | github_releases    | owner/repo                       | https://api.github.com/repos/owner/repo/releases          |
 * | homebrew_cask      | firefox                          | https://formulae.brew.sh/api/cask/firefox.json            |
 * | mac_app_store      | com.tinyspeck.slackmacgap        | https://itunes.apple.com/lookup?bundleId=...&country=us   |
 * | manual             | —                                | null                                                      |
 */
export function resolveSourceUrl(sourceType: string, identifier: string): string | null {
  const trimmed = identifier.trim();
  if (!trimmed) return null;

  switch (sourceType) {
    case "sparkle":
      return trimmed;

    case "github_releases": {
      // Accept "owner/repo" or full GitHub URL
      if (trimmed.includes("/") && !trimmed.startsWith("http")) {
        const [owner, repo] = trimmed.split("/");
        if (owner && repo) {
          return `https://api.github.com/repos/${owner}/${repo}/releases`;
        }
      }
      // Try parsing as full GitHub URL
      const parsed = parseGitHubRepoUrl(trimmed);
      if (parsed) {
        return `https://api.github.com/repos/${parsed.owner}/${parsed.repo}/releases`;
      }
      return null;
    }

    case "homebrew_cask":
      return `https://formulae.brew.sh/api/cask/${encodeURIComponent(trimmed)}.json`;

    case "mac_app_store":
      return `https://itunes.apple.com/lookup?bundleId=${encodeURIComponent(trimmed)}&country=us`;

    case "manual":
      return null;

    default:
      return null;
  }
}

/**
 * Extracts the type-specific identifier from a stored baseUrl.
 * Inverse of {@link resolveSourceUrl} — used to populate the input field
 * when editing an existing source.
 */
export function extractSourceIdentifier(sourceType: string, baseUrl: string | null): string {
  if (!baseUrl) return "";

  switch (sourceType) {
    case "sparkle":
      return baseUrl;

    case "github_releases": {
      const match = /api\.github\.com\/repos\/([^/]+\/[^/]+)\/releases/.exec(baseUrl);
      return match?.[1] ?? baseUrl;
    }

    case "homebrew_cask": {
      const match = /formulae\.brew\.sh\/api\/cask\/([^.]+)\.json/.exec(baseUrl);
      return match?.[1] ? decodeURIComponent(match[1]) : baseUrl;
    }

    case "mac_app_store": {
      const match = /[?&]bundleId=([^&]+)/.exec(baseUrl);
      return match?.[1] ? decodeURIComponent(match[1]) : baseUrl;
    }

    default:
      return baseUrl;
  }
}
