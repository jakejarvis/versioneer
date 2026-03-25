import { describe, it, expect } from "vitest";

import { sparkleParser } from "../sparkle";
import { sparkleFixtures } from "./fixtures/sparkle.fixtures";

describe("Sparkle parser regression fixtures", () => {
  for (const fixture of sparkleFixtures) {
    it(fixture.name, () => {
      const result = sparkleParser.parse(fixture.xml);
      expect(result.releases).toHaveLength(fixture.expectedReleaseCount);
      expect(result.confidence).toBe(fixture.expectedConfidence);
      if (fixture.expectedFirstVersion && result.releases.length > 0) {
        expect(result.releases[0]!.versionRaw).toBe(fixture.expectedFirstVersion);
      }
    });
  }
});
