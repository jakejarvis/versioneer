import { describe, expect, it } from "vite-plus/test";

import { canRetryJobFailure } from "./security-signals";

describe("canRetryJobFailure", () => {
  it("allows retrying retryable pipeline and cron failures", () => {
    expect(canRetryJobFailure("source-fetch")).toBe(true);
    expect(canRetryJobFailure("source-parse")).toBe(true);
    expect(canRetryJobFailure("recompute-latest")).toBe(true);
    expect(canRetryJobFailure("poll_sources")).toBe(true);
    expect(canRetryJobFailure("cask_index_sync")).toBe(true);
    expect(canRetryJobFailure("enrich_discovered_apps")).toBe(true);
  });

  it("keeps informational failures non-retryable", () => {
    expect(canRetryJobFailure("source-anomaly")).toBe(false);
  });
});
