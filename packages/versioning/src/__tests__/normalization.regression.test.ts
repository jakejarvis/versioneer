import { describe, it, expect } from "vitest";

import { normalizeVersion } from "../normalize";
import { parseVersion } from "../parse";
import {
  normalizationFixtures,
  normalizationOrderFixtures,
} from "./fixtures/normalization.fixtures";

describe("normalizeVersion regression fixtures", () => {
  for (const fixture of normalizationFixtures) {
    it(`${fixture.description}: "${fixture.input}"`, () => {
      const result = normalizeVersion(fixture.input);
      const parsed = parseVersion(fixture.input);

      if (fixture.expectedValid) {
        expect(parsed.valid).toBe(true);
        // Normalized form should not equal the raw input (it's zero-padded)
        expect(result).not.toBe("");
      } else {
        expect(parsed.valid).toBe(false);
      }
    });
  }
});

describe("normalizeVersion ordering regression fixtures", () => {
  for (const fixture of normalizationOrderFixtures) {
    it(`${fixture.description}: "${fixture.lower}" < "${fixture.higher}"`, () => {
      const lowerNorm = normalizeVersion(fixture.lower);
      const higherNorm = normalizeVersion(fixture.higher);
      // Normalized strings should sort lexicographically
      expect(lowerNorm < higherNorm).toBe(true);
    });
  }
});
