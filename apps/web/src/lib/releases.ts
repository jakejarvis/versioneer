export interface ChangelogRelease {
  tag_name: string;
  name: string | null;
  body_html: string | null;
  published_at: string | null;
  html_url: string;
  prerelease: boolean;
}

interface FetchChangelogReleasesOptions {
  signal?: AbortSignal;
}

export async function fetchChangelogReleases({
  signal,
}: FetchChangelogReleasesOptions = {}): Promise<ChangelogRelease[]> {
  const response = await fetch("/api/releases", { signal });

  if (!response.ok) {
    throw new Error(`Failed to fetch releases (${response.status})`);
  }

  return (await response.json()) as ChangelogRelease[];
}
