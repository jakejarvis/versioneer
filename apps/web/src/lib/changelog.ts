import type { ChangelogRelease } from "@/lib/releases";

const NIGHTLY_RELEASE_PATTERN = /(?:^|[._-])(nightly|dev)(?:$|[._-]|\d)/i;

type ChangelogReleaseIdentity = Pick<ChangelogRelease, "tag_name" | "name">;

export function isNightlyRelease(release: ChangelogReleaseIdentity): boolean {
  return looksNightly(release.tag_name) || looksNightly(release.name);
}

export function filterChangelogReleases(
  releases: ChangelogRelease[],
  nightly: boolean,
): ChangelogRelease[] {
  if (nightly) return releases;
  return releases.filter((release) => !isNightlyRelease(release));
}

export function countNightlyReleases(releases: ChangelogRelease[]): number {
  return releases.filter(isNightlyRelease).length;
}

function looksNightly(value: string | null): boolean {
  if (!value) return false;
  return NIGHTLY_RELEASE_PATTERN.test(value.trim().toLowerCase());
}
