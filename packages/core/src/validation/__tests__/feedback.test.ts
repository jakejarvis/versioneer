import { describe, expect, it } from "vitest";

import { clientFeedbackSubmitSchema, feedbackUpdateSchema } from "../feedback";

describe("clientFeedbackSubmitSchema", () => {
  it("parses a valid minimal submission", () => {
    const result = clientFeedbackSubmitSchema.parse({ feedbackType: "general" });
    expect(result.feedbackType).toBe("general");
    expect(result.bundleId).toBeUndefined();
  });

  it("parses all feedback types", () => {
    for (const type of ["wrong_match", "wrong_version", "app_request", "general"]) {
      const result = clientFeedbackSubmitSchema.parse({ feedbackType: type });
      expect(result.feedbackType).toBe(type);
    }
  });

  it("parses a fully populated submission", () => {
    const result = clientFeedbackSubmitSchema.parse({
      feedbackType: "wrong_match",
      bundleId: "com.example.app",
      appName: "Example App",
      matchedAppId: "app_123",
      payload: { note: "This matched the wrong app" },
    });
    expect(result.bundleId).toBe("com.example.app");
    expect(result.payload).toEqual({ note: "This matched the wrong app" });
  });

  it("rejects invalid feedbackType", () => {
    expect(() => clientFeedbackSubmitSchema.parse({ feedbackType: "invalid" })).toThrow();
  });

  it("rejects missing feedbackType", () => {
    expect(() => clientFeedbackSubmitSchema.parse({})).toThrow();
  });

  it("rejects bundleId exceeding max length", () => {
    expect(() =>
      clientFeedbackSubmitSchema.parse({
        feedbackType: "general",
        bundleId: "x".repeat(501),
      }),
    ).toThrow();
  });
});

describe("feedbackUpdateSchema", () => {
  it("parses valid statuses", () => {
    for (const status of ["new", "triaged", "resolved", "dismissed"]) {
      const result = feedbackUpdateSchema.parse({ status });
      expect(result.status).toBe(status);
    }
  });

  it("rejects invalid status", () => {
    expect(() => feedbackUpdateSchema.parse({ status: "invalid" })).toThrow();
  });
});
