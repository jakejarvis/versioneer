import { describe, it, expect } from "vitest";

import { githubReleasesParser } from "../github";
import { githubFixtures } from "./fixtures/github.fixtures";

describe("GitHub parser regression fixtures", () => {
  for (const fixture of githubFixtures) {
    it(fixture.name, () => {
      const result = githubReleasesParser.parse(fixture.json);
      expect(result.releases).toHaveLength(fixture.expectedReleaseCount);
      expect(result.confidence).toBe(fixture.expectedConfidence);
      if (fixture.expectedFirstVersion && result.releases.length > 0) {
        expect(result.releases[0]!.versionRaw).toBe(fixture.expectedFirstVersion);
      }
    });
  }
});
