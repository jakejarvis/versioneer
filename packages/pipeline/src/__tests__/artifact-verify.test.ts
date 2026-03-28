import { describe, it, expect } from "vitest";

import { computeTrustLevel } from "../artifact-verify";

describe("computeTrustLevel", () => {
  it("returns untrusted when URL is inaccessible", () => {
    expect(
      computeTrustLevel({
        urlAccessible: false,
        sizeMatch: null,
        hashMatch: null,
        teamIdMatch: null,
      }),
    ).toBe("untrusted");
  });

  it("returns untrusted when hash mismatches", () => {
    expect(
      computeTrustLevel({
        urlAccessible: true,
        sizeMatch: true,
        hashMatch: false,
        teamIdMatch: null,
      }),
    ).toBe("untrusted");
  });

  it("returns untrusted when size mismatches", () => {
    expect(
      computeTrustLevel({
        urlAccessible: true,
        sizeMatch: false,
        hashMatch: null,
        teamIdMatch: null,
      }),
    ).toBe("untrusted");
  });

  it("returns untrusted when team ID mismatches", () => {
    expect(
      computeTrustLevel({
        urlAccessible: true,
        sizeMatch: true,
        hashMatch: true,
        teamIdMatch: false,
      }),
    ).toBe("untrusted");
  });

  it("returns medium when URL accessible, hash matches, and team ID matches", () => {
    expect(
      computeTrustLevel({
        urlAccessible: true,
        sizeMatch: true,
        hashMatch: true,
        teamIdMatch: true,
      }),
    ).toBe("medium");
  });

  it("returns low when hash matches but no team ID info", () => {
    expect(
      computeTrustLevel({
        urlAccessible: true,
        sizeMatch: true,
        hashMatch: true,
        teamIdMatch: null,
      }),
    ).toBe("low");
  });

  it("returns low when hash is skipped", () => {
    expect(
      computeTrustLevel({
        urlAccessible: true,
        sizeMatch: null,
        hashMatch: null,
        teamIdMatch: null,
      }),
    ).toBe("low");
  });

  it("returns low when hash skipped but team ID matches", () => {
    expect(
      computeTrustLevel({
        urlAccessible: true,
        sizeMatch: true,
        hashMatch: null,
        teamIdMatch: true,
      }),
    ).toBe("low");
  });

  it("returns unknown when URL accessibility is null (check errored)", () => {
    expect(
      computeTrustLevel({
        urlAccessible: null,
        sizeMatch: null,
        hashMatch: null,
        teamIdMatch: null,
      }),
    ).toBe("unknown");
  });
});
