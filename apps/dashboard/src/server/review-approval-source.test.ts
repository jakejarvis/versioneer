import { describe, expect, it } from "vite-plus/test";

import { buildApprovedSuggestionSourceInsert } from "./review-approval-source";

describe("buildApprovedSuggestionSourceInsert", () => {
  it("uses source-type poll defaults for approved new sources", () => {
    const now = "2026-04-23T12:34:56.000Z";

    const homebrew = buildApprovedSuggestionSourceInsert({
      id: "src_homebrew",
      appId: "app_123",
      sourceType: "homebrew_cask",
      label: "Homebrew",
      baseUrl: "https://formulae.brew.sh/api/cask/firefox.json",
      parserKey: "homebrew_cask",
      channel: null,
      role: "corroborating",
      status: "active",
      reviewer: "reviewer@example.com",
      now,
    });

    const manual = buildApprovedSuggestionSourceInsert({
      id: "src_manual",
      appId: "app_123",
      sourceType: "manual",
      label: "Manual",
      baseUrl: null,
      parserKey: "manual",
      channel: null,
      role: "authority",
      status: "active",
      reviewer: "reviewer@example.com",
      now,
    });

    expect(homebrew.pollIntervalMinutes).toBe(360);
    expect(homebrew.nextPollAt).toBe(now);
    expect(manual.pollIntervalMinutes).toBe(1440);
    expect(manual.nextPollAt).toBe(now);
  });
});
