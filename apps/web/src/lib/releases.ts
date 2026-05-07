const DOWNLOADS_HOST = "https://dl.versioneer.app";

interface ReleaseDownloads {
  dmgUrl: string;
  zipUrl: string;
}

interface ReleaseDownloadInput {
  prerelease: boolean;
  tagName: string;
}

export interface Release {
  tag_name: string;
  name: string | null;
  body_html: string | null;
  published_at: string | null;
  html_url: string;
  downloads: ReleaseDownloads | null;
  prerelease: boolean;
}

interface FetchReleasesOptions {
  signal?: AbortSignal;
}

export async function fetchReleases({ signal }: FetchReleasesOptions = {}): Promise<Release[]> {
  const response = await fetch("/api/releases", { signal });

  if (!response.ok) {
    throw new Error(`Failed to fetch releases (${response.status})`);
  }

  return (await response.json()) as Release[];
}

export function getReleaseDownloads({
  prerelease,
  tagName,
}: ReleaseDownloadInput): ReleaseDownloads | null {
  if (tagName.startsWith("nightly-")) {
    return immutableDownloadsFor(`nightly/downloads/Versioneer-${tagName}`);
  }

  if (!prerelease && tagName.startsWith("v")) {
    const version = tagName.slice(1);
    if (version.length > 0) {
      return immutableDownloadsFor(`downloads/Versioneer-${version}`);
    }
  }

  return null;
}

function immutableDownloadsFor(pathStem: string): ReleaseDownloads {
  return {
    dmgUrl: `${DOWNLOADS_HOST}/${pathStem}.dmg`,
    zipUrl: `${DOWNLOADS_HOST}/${pathStem}.zip`,
  };
}

const NIGHTLY_RELEASE_PATTERN = /(?:^|[._-])(nightly|dev)(?:$|[._-]|\d)/i;

type ReleaseIdentity = Pick<Release, "tag_name" | "name">;

export function isNightlyRelease(release: ReleaseIdentity): boolean {
  return looksNightly(release.tag_name) || looksNightly(release.name);
}

export function filterReleases(releases: Release[], nightly: boolean): Release[] {
  if (nightly) return releases;
  return releases.filter((release) => !isNightlyRelease(release));
}

export function countNightlyReleases(releases: Release[]): number {
  return releases.filter(isNightlyRelease).length;
}

function looksNightly(value: string | null): boolean {
  if (!value) return false;
  return NIGHTLY_RELEASE_PATTERN.test(value.trim().toLowerCase());
}
