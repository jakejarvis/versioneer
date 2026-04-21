import { beforeEach, describe, expect, it, vi } from "vitest";

import { computeStaleSince, isArchCompatible, isOsVersionCompatible } from "../helpers";

const TEST_NOW = new Date("2026-03-31T12:00:00.000Z");

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(TEST_NOW);
});

describe("isOsVersionCompatible", () => {
  it("returns true when no minimum is set", () => {
    expect(isOsVersionCompatible("15.0", null)).toBe(true);
  });

  it("returns true when client OS is unknown", () => {
    expect(isOsVersionCompatible(null, "13.0")).toBe(true);
    expect(isOsVersionCompatible(undefined, "13.0")).toBe(true);
  });

  it("returns true when versions are equal", () => {
    expect(isOsVersionCompatible("15.0", "15.0")).toBe(true);
  });

  it("returns true when current exceeds minimum", () => {
    expect(isOsVersionCompatible("15.1", "15.0")).toBe(true);
    expect(isOsVersionCompatible("16.0", "15.4")).toBe(true);
  });

  it("returns false when current is below minimum", () => {
    expect(isOsVersionCompatible("14.0", "15.0")).toBe(false);
    expect(isOsVersionCompatible("15.0", "15.1")).toBe(false);
  });

  it("handles different version segment lengths", () => {
    expect(isOsVersionCompatible("15", "15.0.0")).toBe(true);
    expect(isOsVersionCompatible("15.0.0", "15")).toBe(true);
    expect(isOsVersionCompatible("14.7", "15.0.0")).toBe(false);
  });
});

describe("isArchCompatible", () => {
  it("returns true when artifact arch is unspecified", () => {
    expect(isArchCompatible(null, "arm64")).toBe(true);
  });

  it("returns true when client arch is unknown", () => {
    expect(isArchCompatible("arm64", null)).toBe(true);
    expect(isArchCompatible("arm64", undefined)).toBe(true);
  });

  it("returns true for universal artifacts", () => {
    expect(isArchCompatible("universal", "arm64")).toBe(true);
    expect(isArchCompatible("universal", "x86_64")).toBe(true);
  });

  it("returns true for matching architectures", () => {
    expect(isArchCompatible("arm64", "arm64")).toBe(true);
    expect(isArchCompatible("x86_64", "x86_64")).toBe(true);
  });

  it("returns false for mismatched architectures", () => {
    expect(isArchCompatible("arm64", "x86_64")).toBe(false);
    expect(isArchCompatible("x86_64", "arm64")).toBe(false);
  });
});

describe("computeStaleSince", () => {
  it("returns null when no lastSuccessAt", () => {
    expect(computeStaleSince(null)).toBeNull();
  });

  it("returns null for recent success", () => {
    const recent = TEST_NOW.toISOString();
    expect(computeStaleSince(recent)).toBeNull();
  });

  it("returns the date for stale source (>30 days)", () => {
    const old = new Date(TEST_NOW.getTime() - 31 * 24 * 60 * 60 * 1000).toISOString();
    expect(computeStaleSince(old)).toBe(old);
  });
});
