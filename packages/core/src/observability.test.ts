import { describe, expect, it, vi } from "vite-plus/test";

import {
  captureServerEvent,
  getPostHogHost,
  safeFailureMetadata,
  sanitizeAnalyticsProperties,
} from "./observability";

describe("observability helpers", () => {
  it("uses the US PostHog host by default", () => {
    expect(getPostHogHost({})).toBe("https://us.i.posthog.com");
    expect(getPostHogHost({ POSTHOG_HOST: "https://eu.i.posthog.com" })).toBe(
      "https://eu.i.posthog.com",
    );
  });

  it("does not capture when PostHog env is missing", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");

    await expect(
      captureServerEvent({}, { event: "admin_signed_in", distinctId: "admin-1" }),
    ).resolves.toBe(false);

    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("strips sensitive property names from analytics metadata", () => {
    expect(
      sanitizeAnalyticsProperties({
        surface: "api",
        target_id: "app-1",
        authorization: "Bearer secret",
        requestBody: { name: "Versioneer" },
        nested: {
          status: "failed",
          githubToken: "ghp_secret",
          failure_reason: "authorization=Bearer abc123",
        },
      }),
    ).toEqual({
      surface: "api",
      target_id: "app-1",
      nested: {
        status: "failed",
        failure_reason: "authorization=[redacted]",
      },
    });
  });

  it("serializes safe failure metadata only", () => {
    const error = new Error("boom Bearer secret-token");
    error.stack = "Error: boom\n    at secret";

    expect(safeFailureMetadata(error)).toEqual({
      error_name: "Error",
      error_message: "boom Bearer [redacted]",
    });
  });
});
