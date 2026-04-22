import { env } from "cloudflare:workers";
import { HTTPException } from "hono/http-exception";
import { beforeEach, describe, expect, it, vi } from "vite-plus/test";

import app from "../index";

app.get("/__test/unhandled-error", () => {
  throw new Error("boom");
});

app.post("/__test/http-5xx", () => {
  throw new HTTPException(503, { message: "unavailable" });
});

describe("API observability", () => {
  const posthogEnv = {
    ...env,
    POSTHOG_PROJECT_TOKEN: "phc_test",
    POSTHOG_HOST: "https://us.i.posthog.com",
  } as Env;

  beforeEach(() => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("{}", { status: 200 })),
    );
  });

  it("captures unhandled Hono errors with safe request metadata", async () => {
    const res = await app.request("/__test/unhandled-error", {}, posthogEnv);

    expect(res.status).toBe(500);
    await vi.waitFor(() => {
      expect(fetch).toHaveBeenCalled();
    });
    const bodies = await capturedBodies();
    expect(bodies).toContain("/__test/unhandled-error");
    expect(bodies).toContain('"status":500');
  });

  it("does not call PostHog when the project token is absent", async () => {
    const res = await app.request(
      "/__test/http-5xx",
      {
        method: "POST",
      },
      env,
    );

    expect(res.status).toBe(503);
    expect(fetch).not.toHaveBeenCalled();
  });

  it("captures HTTP 5xx exceptions but not request bodies or headers", async () => {
    const res = await app.request(
      "/__test/http-5xx",
      {
        method: "POST",
        headers: { Authorization: "Bearer secret" },
        body: JSON.stringify({ secret: "do-not-capture" }),
      },
      posthogEnv,
    );

    expect(res.status).toBe(503);
    await vi.waitFor(() => {
      expect(fetch).toHaveBeenCalled();
    });

    const bodies = await capturedBodies();
    expect(bodies).toContain("/__test/http-5xx");
    expect(bodies).toContain('"status":503');
    expect(bodies).not.toContain("Bearer secret");
    expect(bodies).not.toContain("do-not-capture");
  });
});

async function capturedBodies(): Promise<string> {
  const parts: string[] = [];
  for (const [input, init] of vi.mocked(fetch).mock.calls) {
    const body = init?.body ?? (input instanceof Request ? input.clone().body : undefined);
    if (typeof body === "string") {
      parts.push(body);
    } else if (body instanceof URLSearchParams) {
      parts.push(body.toString());
    } else if (body instanceof Blob) {
      parts.push(await body.text());
    } else if (body instanceof ArrayBuffer) {
      parts.push(new TextDecoder().decode(body));
    } else if (ArrayBuffer.isView(body)) {
      parts.push(new TextDecoder().decode(body));
    } else if (body instanceof ReadableStream) {
      parts.push(await new Response(body).text());
    }
  }
  return parts.join("\n");
}
