import { parseGitHubRepoUrl } from "./github-url";

const ELECTRON_FEED_FILENAMES = ["latest-mac.yml", "latest.yml"] as const;

/**
 * Canonicalizes any user-supplied electron_generic URL into a stable form
 * suitable for storage and alias matching.
 *
 * - GitHub variants (`owner/repo`, `…/releases`, `…/releases/latest`) →
 *   `https://github.com/{owner}/{repo}/releases`  (matches what the desktop
 *   client reports via `app-update.yml`).
 * - Everything else passes through unchanged.
 */
export function canonicalizeElectronBaseUrl(input: string): string {
  const gh = parseGitHubRepoUrl(input);
  if (gh) return `https://github.com/${gh.owner}/${gh.repo}/releases`;
  return input;
}

/**
 * Returns the base directory URL against which relative artifact paths
 * in an electron-updater YAML should be resolved.
 *
 * - GitHub URLs → `…/releases/latest/download` (where release assets live).
 * - Generic URLs → the URL itself (with trailing-slash normalization).
 */
export function resolveElectronArtifactBase(baseUrl: string): string {
  const gh = parseGitHubRepoUrl(baseUrl);
  if (gh) return `https://github.com/${gh.owner}/${gh.repo}/releases/latest/download`;
  return baseUrl;
}

/**
 * Given an electron_generic base URL, returns an ordered list of candidate
 * feed URLs to try.  Handles GitHub release URLs specially — for those the
 * yml lives at `…/releases/latest/download/<file>`.
 */
export function buildElectronFeedCandidates(baseUrl: string): string[] {
  // Already a direct yml reference — use as-is.
  if (ELECTRON_FEED_FILENAMES.some((f) => baseUrl.endsWith(f))) return [baseUrl];

  // GitHub HTML URL → rewrite to the download path for the latest release.
  const gh = parseGitHubRepoUrl(baseUrl);
  if (gh) {
    const prefix = `https://github.com/${gh.owner}/${gh.repo}/releases/latest/download`;
    return ELECTRON_FEED_FILENAMES.map((f) => `${prefix}/${f}`);
  }

  // Generic base URL — append each candidate filename.
  const normalized = baseUrl.endsWith("/") ? baseUrl : `${baseUrl}/`;
  return ELECTRON_FEED_FILENAMES.map((f) => `${normalized}${f}`);
}
