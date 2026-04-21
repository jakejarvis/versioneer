import { describe, it, expect } from "vitest";

import { sparkleParser } from "../sparkle";
import { sparkleFixtures } from "./fixtures/sparkle.fixtures";

describe("Sparkle parser regression fixtures", () => {
  it.each(sparkleFixtures)("$name", (fixture) => {
    const result = sparkleParser.parse(fixture.xml);
    expect(result.releases).toHaveLength(fixture.expectedReleaseCount);
    expect(result.confidence).toBe(fixture.expectedConfidence);
    expect(fixture.expectedFirstVersion ? result.releases[0]?.versionRaw : undefined).toBe(
      fixture.expectedFirstVersion,
    );
  });
});
