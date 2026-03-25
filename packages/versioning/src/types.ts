export interface ParsedVersion {
  /** Original raw version string */
  raw: string;
  /** Normalized comparable string */
  normalized: string;
  /** Major version number */
  major: number;
  /** Minor version number */
  minor: number;
  /** Patch version number */
  patch: number;
  /** Additional numeric segments beyond major.minor.patch */
  extra: number[];
  /** Pre-release tag (e.g., "beta", "alpha", "rc") */
  preReleaseTag: string | null;
  /** Pre-release number (e.g., 3 in "beta3") */
  preReleaseNumber: number | null;
  /** Build metadata (e.g., build number after +) */
  buildMetadata: string | null;
  /** Whether this was successfully parsed */
  valid: boolean;
}

export type ComparisonResult = -1 | 0 | 1;
