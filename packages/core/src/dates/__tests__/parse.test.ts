import { describe, expect, it } from "vite-plus/test";

import { inferReleasedAt, toISODate } from "../parse";

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

  it("converts RFC 2822 without weekday", () => {
    expect(toISODate("15 Jan 2024 12:00:00 +0000")).toBe("2024-01-15T12:00:00.000Z");
  });

  it("converts RFC 2822 with GMT timezone", () => {
    expect(toISODate("Mon, 15 Jan 2024 12:00:00 GMT")).toBe("2024-01-15T12:00:00.000Z");
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
    expect(toISODate("12.7.4")).toBeNull();
    expect(toISODate("6.6.0")).toBeNull();
    expect(toISODate("1")).toBeNull();
  });

  it("returns null for partial date strings", () => {
    expect(toISODate("2024-13-45")).toBeNull();
  });

  it("returns null for impossible ISO calendar dates", () => {
    expect(toISODate("2024-02-31")).toBeNull();
    expect(toISODate("2024-04-31T12:00:00Z")).toBeNull();
  });

  it("returns null for impossible RFC 2822 calendar dates", () => {
    expect(toISODate("Wed, 31 Feb 2026 06:36:00 +0000")).toBeNull();
  });
});

describe("inferReleasedAt", () => {
  const now = "2026-03-31T12:00:00.000Z";

  it("uses parser-provided date regardless of initial fetch flag", () => {
    expect(inferReleasedAt("2024-01-15T12:00:00Z", true, now)).toBe("2024-01-15T12:00:00.000Z");
    expect(inferReleasedAt("2024-01-15T12:00:00Z", false, now)).toBe("2024-01-15T12:00:00.000Z");
  });

  it("returns null when no date and initial fetch (bootstrap)", () => {
    expect(inferReleasedAt(null, true, now)).toBeNull();
    expect(inferReleasedAt(undefined, true, now)).toBeNull();
  });

  it("infers now when no date and non-initial fetch", () => {
    expect(inferReleasedAt(null, false, now)).toBe(now);
    expect(inferReleasedAt(undefined, false, now)).toBe(now);
  });

  it("infers now when parser date is unparseable and non-initial fetch", () => {
    expect(inferReleasedAt("not-a-date", false, now)).toBe(now);
  });

  it("returns null when parser date is unparseable and initial fetch", () => {
    expect(inferReleasedAt("not-a-date", true, now)).toBeNull();
  });
});
