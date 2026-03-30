import type { ParsedVersion } from "./types";

const PRE_RELEASE_TAGS: Record<string, number> = {
  alpha: 0,
  a: 0,
  beta: 1,
  b: 1,
  dev: -1,
  nightly: -1,
  rc: 2,
  cr: 2,
  preview: 1,
  pre: 1,
};

/**
 * Parse a version string into structured components.
 * Handles: semver, 1.2, 1.2.3, 2024.9, 5.0b3, 1.0-rc1, 1.0+build123
 */
export function parseVersion(raw: string): ParsedVersion {
  const trimmed = raw.trim();

  if (!trimmed) {
    return emptyVersion(raw);
  }

  // Strip leading 'v' or 'V'
  let working = trimmed.replace(/^[vV]/, "");

  // Strip leading name prefix (e.g. "release-3.5.7", "XQuartz-2.8.6_beta4").
  // Only strip when the prefix is NOT a known pre-release tag — otherwise
  // "beta-1.0" would lose its pre-release meaning.
  const namePrefixMatch = working.match(/^([a-zA-Z]+)[-_](?=\d)/);
  if (namePrefixMatch && !(namePrefixMatch[1]!.toLowerCase() in PRE_RELEASE_TAGS)) {
    working = working.slice(namePrefixMatch[0]!.length);
  }

  // Extract build metadata after '+'
  let buildMetadata: string | null = null;
  const plusIndex = working.indexOf("+");
  if (plusIndex !== -1) {
    buildMetadata = working.slice(plusIndex + 1);
    working = working.slice(0, plusIndex);
  }

  // Extract pre-release info
  let preReleaseTag: string | null = null;
  let preReleaseNumber: number | null = null;

  // Pattern: version-beta.3, version-rc1, version-alpha
  const dashPreRelease = working.match(/^([\d.]+)[_-]([a-zA-Z]+)\.?(\d+)?$/);
  if (dashPreRelease) {
    working = dashPreRelease[1]!;
    preReleaseTag = dashPreRelease[2]!.toLowerCase();
    if (dashPreRelease[3]) {
      preReleaseNumber = parseInt(dashPreRelease[3], 10);
    }
  } else {
    // Pattern: 5.0b3, 1.0alpha2
    const inlinePreRelease = working.match(/^([\d.]+?)([a-zA-Z]+)(\d*)$/);
    if (inlinePreRelease) {
      working = inlinePreRelease[1]!;
      preReleaseTag = inlinePreRelease[2]!.toLowerCase();
      if (inlinePreRelease[3]) {
        preReleaseNumber = parseInt(inlinePreRelease[3], 10);
      }
    }
  }

  // Reject consecutive dots (e.g. "1..2")
  if (/\.{2,}/.test(working)) {
    return emptyVersion(raw);
  }

  // Strip trailing dots (e.g. "1.2.3." → "1.2.3")
  working = working.replace(/\.+$/, "");

  // Parse numeric segments, clamping to valid range
  const MAX_SEGMENT = 9999999999; // 10 digits — must fit zero-padded normalization
  const segments = working.split(".").map((s) => {
    const n = parseInt(s, 10);
    if (isNaN(n)) return 0;
    return Math.min(Math.max(n, 0), MAX_SEGMENT);
  });

  if (segments.length === 0 || (segments.length === 1 && segments[0] === 0 && working !== "0")) {
    return emptyVersion(raw);
  }

  const major = segments[0] ?? 0;
  const minor = segments[1] ?? 0;
  const patch = segments[2] ?? 0;
  const extra = segments.slice(3);

  const normalized = buildNormalized(major, minor, patch, extra, preReleaseTag, preReleaseNumber);

  return {
    raw: trimmed,
    normalized,
    major,
    minor,
    patch,
    extra,
    preReleaseTag,
    preReleaseNumber,
    buildMetadata,
    valid: true,
  };
}

function buildNormalized(
  major: number,
  minor: number,
  patch: number,
  extra: number[],
  preReleaseTag: string | null,
  preReleaseNumber: number | null,
): string {
  // Pad each segment to 10 digits for lexicographic comparison
  let norm = [major, minor, patch, ...extra].map((n) => String(n).padStart(10, "0")).join(".");

  if (preReleaseTag) {
    const tagOrder = PRE_RELEASE_TAGS[preReleaseTag] ?? 1;
    // Pre-release sorts before release: use -0 prefix (sorts before -1 used for releases)
    norm += `-0.${String(tagOrder).padStart(3, "0")}`;
    norm += `.${String(preReleaseNumber ?? 0).padStart(10, "0")}`;
  } else {
    // Release versions get -1 suffix so they sort after pre-releases
    norm += `-1`;
  }

  return norm;
}

function emptyVersion(raw: string): ParsedVersion {
  return {
    raw,
    normalized: "",
    major: 0,
    minor: 0,
    patch: 0,
    extra: [],
    preReleaseTag: null,
    preReleaseNumber: null,
    buildMetadata: null,
    valid: false,
  };
}
