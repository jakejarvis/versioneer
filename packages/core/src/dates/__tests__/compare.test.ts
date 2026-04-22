import { describe, expect, it } from "vite-plus/test";

import { toEpochMs, msElapsedSince, compareDatesDesc, durationMs } from "../compare";

describe("toEpochMs", () => {
  it("returns epoch ms for valid ISO string", () => {
    expect(toEpochMs("2024-01-15T12:00:00.000Z")).toBe(1705320000000);
  });

  it("returns null for null", () => {
    expect(toEpochMs(null)).toBeNull();
  });

  it("returns null for undefined", () => {
    expect(toEpochMs(undefined)).toBeNull();
  });

  it("returns null for empty string", () => {
    expect(toEpochMs("")).toBeNull();
  });

  it("returns null for garbage", () => {
    expect(toEpochMs("not-a-date")).toBeNull();
  });
});

describe("msElapsedSince", () => {
  const fixedNow = new Date("2024-01-15T13:00:00.000Z").getTime();

  it("returns positive value for past date", () => {
    expect(msElapsedSince("2024-01-15T12:00:00.000Z", fixedNow)).toBe(3600000);
  });

  it("returns negative value for future date", () => {
    expect(msElapsedSince("2024-01-15T14:00:00.000Z", fixedNow)).toBe(-3600000);
  });

  it("returns null for null input", () => {
    expect(msElapsedSince(null, fixedNow)).toBeNull();
  });

  it("returns null for garbage input", () => {
    expect(msElapsedSince("garbage", fixedNow)).toBeNull();
  });
});

describe("compareDatesDesc", () => {
  it("sorts newer dates first", () => {
    const dates = ["2024-01-10T00:00:00Z", "2024-01-15T00:00:00Z", "2024-01-12T00:00:00Z"];
    const sorted = [...dates].sort(compareDatesDesc);
    expect(sorted).toEqual([
      "2024-01-15T00:00:00Z",
      "2024-01-12T00:00:00Z",
      "2024-01-10T00:00:00Z",
    ]);
  });

  it("pushes null values to end", () => {
    const dates: (string | null)[] = [null, "2024-01-15T00:00:00Z", null, "2024-01-10T00:00:00Z"];
    const sorted = [...dates].sort(compareDatesDesc);
    expect(sorted[0]).toBe("2024-01-15T00:00:00Z");
    expect(sorted[1]).toBe("2024-01-10T00:00:00Z");
  });

  it("handles two nulls as equal", () => {
    expect(compareDatesDesc(null, null)).toBe(0);
  });
});

describe("durationMs", () => {
  it("returns correct duration", () => {
    expect(durationMs("2024-01-15T12:00:00Z", "2024-01-15T12:05:00Z")).toBe(300000);
  });

  it("returns null if start is invalid", () => {
    expect(durationMs("garbage", "2024-01-15T12:05:00Z")).toBeNull();
  });

  it("returns null if end is invalid", () => {
    expect(durationMs("2024-01-15T12:00:00Z", null)).toBeNull();
  });

  it("returns null if both are invalid", () => {
    expect(durationMs(null, null)).toBeNull();
  });

  it("returns negative for reversed timestamps", () => {
    expect(durationMs("2024-01-15T12:05:00Z", "2024-01-15T12:00:00Z")).toBe(-300000);
  });
});
