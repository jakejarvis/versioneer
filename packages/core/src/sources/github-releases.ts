import { githubApiHeaders } from "../pipeline/types";
import { toGitHubApiReleasesUrl } from "../validation/github-url";
import { defaultDescriptor } from "./default";
import type { SourceTypeDescriptor } from "./types";

const GITHUB_API_RELEASES_RE = /repos\/([^/]+)\/([^/]+)\/releases/;

/**
 * Converts a GitHub API releases URL back to the HTML repo URL.
 * e.g. `https://api.github.com/repos/owner/repo/releases` → `https://github.com/owner/repo`
 */
export function toGitHubRepoUrl(apiUrl: string): string {
  const match = GITHUB_API_RELEASES_RE.exec(apiUrl);
  if (match) return `https://github.com/${match[1]}/${match[2]}`;
  return apiUrl;
}

export const githubReleasesDescriptor: SourceTypeDescriptor = {
  ...defaultDescriptor,

  resolveUrl(identifier) {
    // Accept "owner/repo" shorthand
    if (identifier.includes("/") && !identifier.startsWith("http")) {
      const [owner, repo] = identifier.split("/");
      if (owner && repo) {
        return `https://api.github.com/repos/${owner}/${repo}/releases`;
      }
    }
    return toGitHubApiReleasesUrl(identifier);
  },

  extractIdentifier(baseUrl) {
    const match = GITHUB_API_RELEASES_RE.exec(baseUrl);
    return match ? `${match[1]}/${match[2]}` : baseUrl;
  },

  fetchHeaders: (tokens) => githubApiHeaders(tokens.githubToken),

  derivedAlias: (baseUrl) => ({ aliasType: "github_repo", value: toGitHubRepoUrl(baseUrl) }),
};
