import { describe, it, expect } from "vitest";

import { githubReleasesParser } from "../github";
import { githubFixtures } from "./fixtures/github.fixtures";

describe("GitHub parser regression fixtures", () => {
  it.each(githubFixtures)("$name", (fixture) => {
    const result = githubReleasesParser.parse(fixture.json);
    expect(result.releases).toHaveLength(fixture.expectedReleaseCount);
    expect(result.confidence).toBe(fixture.expectedConfidence);
    expect(fixture.expectedFirstVersion ? result.releases[0]?.versionRaw : undefined).toBe(
      fixture.expectedFirstVersion,
    );
  });
});
