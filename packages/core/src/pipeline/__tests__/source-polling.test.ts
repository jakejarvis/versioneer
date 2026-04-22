import { describe, expect, it, vi } from "vite-plus/test";

import { computeNextPollAt, initialNextPollAt } from "../source-polling";

describe("computeNextPollAt", () => {
  it("adds the interval to a normalized base time", () => {
    expect(
      computeNextPollAt({
        baseTime: "2026-04-22T20:00:00.000Z",
        pollIntervalMinutes: 60,
        now: "2026-04-22T21:00:00.000Z",
      }),
    ).toBe("2026-04-22T21:00:00.000Z");
  });

  it("falls back to now for invalid base times", () => {
    expect(
      computeNextPollAt({
        baseTime: "12.7.4",
        pollIntervalMinutes: 15,
        now: "2026-04-22T20:00:00.000Z",
      }),
    ).toBe("2026-04-22T20:15:00.000Z");
  });

  it("falls back to current time for invalid now values", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-04-22T20:00:00.000Z"));
    try {
      expect(
        computeNextPollAt({
          baseTime: null,
          pollIntervalMinutes: 15,
          now: "12.7.4",
        }),
      ).toBe("2026-04-22T20:15:00.000Z");
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("initialNextPollAt", () => {
  it("returns null for inactive sources", () => {
    expect(
      initialNextPollAt({
        status: "disabled",
        pollIntervalMinutes: 60,
        now: "2026-04-22T20:00:00.000Z",
      }),
    ).toBeNull();
  });

  it("normalizes active source initial poll time", () => {
    expect(
      initialNextPollAt({
        status: "active",
        pollIntervalMinutes: 60,
        now: "Wed, 22 Apr 2026 20:00:00 +0000",
      }),
    ).toBe("2026-04-22T20:00:00.000Z");
  });
});
