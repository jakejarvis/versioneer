import { describe, it, expect } from "vite-plus/test";

import { matchApp } from "../matcher";
import { matchingFixtures } from "./fixtures/matching.fixtures";

describe("matchApp regression fixtures", () => {
  it.each(matchingFixtures)("$name", (fixture) => {
    const result = matchApp(fixture.input, fixture.aliases);
    expect(result.matched).toBe(fixture.expectedMatched);
    expect(result.method).toBe(fixture.expectedMethod);
    expect(result.appId).toBe(fixture.expectedAppId);
    expect(result.ambiguous).toBe(fixture.expectedAmbiguous);
  });
});
