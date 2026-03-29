const GITHUB_URL_RE = /^https?:\/\/(?:www\.)?github\.com\/([^/]+)\/([^/]+)/;

/**
 * Parses a GitHub repository URL into owner and repo components.
 * Accepts URLs like:
 *   https://github.com/owner/repo
 *   https://github.com/owner/repo/releases
 *   https://github.com/owner/repo/releases/latest
 *   https://www.github.com/owner/repo
 */
export function parseGitHubRepoUrl(url: string): { owner: string; repo: string } | null {
  const match = GITHUB_URL_RE.exec(url);
  if (!match) return null;

  const owner = match[1];
  const repo = match[2];
  if (!owner || !repo) return null;

  return { owner, repo };
}

/**
 * Converts a GitHub HTML URL to the corresponding API releases URL.
 * Returns `https://api.github.com/repos/{owner}/{repo}/releases` or null
 * if the input is not a valid GitHub repository URL.
 */
export function toGitHubApiReleasesUrl(url: string): string | null {
  const parsed = parseGitHubRepoUrl(url);
  if (!parsed) return null;
  return `https://api.github.com/repos/${parsed.owner}/${parsed.repo}/releases`;
}
