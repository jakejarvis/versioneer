export interface NormalizationFixture {
  input: string;
  expectedValid: boolean;
  description: string;
}

// These fixtures test that normalizeVersion returns a consistent, parseable result.
// The normalized format uses zero-padded segments for lexicographic comparison,
// so we test validity and relative ordering rather than exact string output.
export const normalizationFixtures: NormalizationFixture[] = [
  { input: "1.0.0", expectedValid: true, description: "standard semver" },
  { input: "1.2", expectedValid: true, description: "two-segment version" },
  { input: "1.2.3.4", expectedValid: true, description: "four-segment version" },
  { input: "2024.9", expectedValid: true, description: "date-like version" },
  { input: "v2.1.0", expectedValid: true, description: "leading v" },
  { input: "V3.0.0", expectedValid: true, description: "leading uppercase V" },
  { input: "5.0b3", expectedValid: true, description: "inline pre-release" },
  { input: "1.0.0-beta.1", expectedValid: true, description: "dash pre-release" },
  { input: "1.0.0-rc1", expectedValid: true, description: "release candidate" },
  { input: "1.0.0+build123", expectedValid: true, description: "build metadata stripped" },
  {
    input: "1.0.0-alpha+build",
    expectedValid: true,
    description: "pre-release with build metadata",
  },
  { input: " 1.0.0 ", expectedValid: true, description: "whitespace padding" },
  { input: "0.0.1", expectedValid: true, description: "low version" },
  { input: "", expectedValid: false, description: "empty string" },
  { input: "1.2.3.", expectedValid: true, description: "trailing dot stripped" },
  { input: "1..2", expectedValid: false, description: "consecutive dots rejected" },
  { input: "-1.0.0", expectedValid: true, description: "negative segment clamped to zero" },
  { input: "99999999999.0.0", expectedValid: true, description: "large segment clamped to max" },
  { input: "5", expectedValid: true, description: "single segment" },
];

export interface NormalizationOrderFixture {
  lower: string;
  higher: string;
  description: string;
}

export const normalizationOrderFixtures: NormalizationOrderFixture[] = [
  { lower: "1.0.0", higher: "2.0.0", description: "major version ordering" },
  { lower: "1.0.0", higher: "1.1.0", description: "minor version ordering" },
  { lower: "1.0.0", higher: "1.0.1", description: "patch version ordering" },
  { lower: "1.0.0-alpha", higher: "1.0.0-beta", description: "pre-release alpha < beta" },
  { lower: "1.0.0-beta", higher: "1.0.0-rc1", description: "pre-release beta < rc" },
  { lower: "1.0.0-rc1", higher: "1.0.0", description: "pre-release < release" },
  { lower: "1.0.0-beta.1", higher: "1.0.0-beta.2", description: "pre-release number ordering" },
  { lower: "0.9.9", higher: "1.0.0", description: "version rollover" },
  {
    lower: "9999999999.0.0",
    higher: "9999999999.0.1",
    description: "max-width segments still order",
  },
  { lower: "5", higher: "5.0.1", description: "single segment vs multi-segment" },
];
