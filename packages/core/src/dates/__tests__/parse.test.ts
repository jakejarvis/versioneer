import { describe, expect, it } from "vitest";

import { toISODate } from "../parse";

describe("toISODate", () => {
  it("normalizes ISO 8601 with Z suffix", () => {
    expect(toISODate("2024-01-15T12:00:00Z")).toBe("2024-01-15T12:00:00.000Z");
  });

  it("preserves already-normalized ISO 8601", () => {
    expect(toISODate("2024-01-15T12:00:00.000Z")).toBe("2024-01-15T12:00:00.000Z");
  });

  it("normalizes ISO 8601 with offset", () => {
    expect(toISODate("2024-01-15T14:00:00+02:00")).toBe("2024-01-15T12:00:00.000Z");
  });

  it("converts RFC 2822 (Sparkle pubDate format)", () => {
    expect(toISODate("Mon, 15 Jan 2024 12:00:00 +0000")).toBe("2024-01-15T12:00:00.000Z");
  });

  it("converts RFC 2822 with timezone offset", () => {
    const result = toISODate("Fri, 29 Mar 2024 10:30:00 -0400");
    expect(result).toBe("2024-03-29T14:30:00.000Z");
  });

  it("converts date-only ISO string to midnight UTC", () => {
    expect(toISODate("2024-01-15")).toBe("2024-01-15T00:00:00.000Z");
  });

  it("returns null for null input", () => {
    expect(toISODate(null)).toBeNull();
  });

  it("returns null for undefined input", () => {
    expect(toISODate(undefined)).toBeNull();
  });

  it("returns null for empty string", () => {
    expect(toISODate("")).toBeNull();
  });

  it("returns null for garbage input", () => {
    expect(toISODate("not-a-date")).toBeNull();
  });

  it("returns null for version-like strings", () => {
    expect(toISODate("Version 2.0")).toBeNull();
  });

  it("returns null for partial date strings", () => {
    expect(toISODate("2024-13-45")).toBeNull();
  });
});
