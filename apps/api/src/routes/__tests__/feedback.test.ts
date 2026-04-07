import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";

import app from "../../index";

describe("POST /v1/feedback", () => {
  it("creates feedback and returns ID", async () => {
    const res = await app.request(
      "/v1/feedback",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          feedbackType: "general",
          appName: "Test App",
          bundleId: "com.example.test",
        }),
      },
      env,
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { id: string; status: string };
    expect(body.id).toMatch(/^fb_/);
    expect(body.status).toBe("received");
  });

  it("returns 400 for invalid feedbackType", async () => {
    const res = await app.request(
      "/v1/feedback",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ feedbackType: "invalid" }),
      },
      env,
    );
    expect(res.status).toBe(400);
  });

  it("returns 400 for missing body", async () => {
    const res = await app.request(
      "/v1/feedback",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      },
      env,
    );
    expect(res.status).toBe(400);
  });
});
