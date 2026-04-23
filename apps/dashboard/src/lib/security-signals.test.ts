import { describe, expect, it } from "vite-plus/test";

import {
  canRetryJobFailure,
  getInstallTrustReasonCopy,
  getSourceAnomalyCopy,
} from "./security-signals";

describe("canRetryJobFailure", () => {
  it("allows retrying retryable pipeline and cron failures", () => {
    expect(canRetryJobFailure("source-fetch")).toBe(true);
    expect(canRetryJobFailure("source-parse")).toBe(true);
    expect(canRetryJobFailure("recompute-latest")).toBe(true);
    expect(canRetryJobFailure("poll_sources")).toBe(true);
    expect(canRetryJobFailure("cask_index_sync")).toBe(true);
    expect(canRetryJobFailure("enrich_discovered_apps")).toBe(true);
    expect(canRetryJobFailure("inventory_followup")).toBe(true);
  });

  it("keeps informational failures non-retryable", () => {
    expect(canRetryJobFailure("source-anomaly")).toBe(false);
  });
});

describe("relaxed install trust copy", () => {
  it("treats relaxed trust reasons as warnings instead of blockers", () => {
    expect(getInstallTrustReasonCopy("missing_sha256").tone).toBe("warning");
    expect(getInstallTrustReasonCopy("missing_sparkle_public_key").tone).toBe("warning");
    expect(getInstallTrustReasonCopy("unknown_architecture").tone).toBe("warning");
  });

  it("downgrades missing install hash anomalies to warnings", () => {
    expect(getSourceAnomalyCopy("missing_install_hash:https://example.com/app.dmg").tone).toBe(
      "warning",
    );
  });
});
