import { Hono } from "hono";
import { cors } from "hono/cors";
import { HTTPException } from "hono/http-exception";

import { createLogger } from "@versioneer/core/logger";

import { captureApiException } from "./lib/observability";
import { routes } from "./routes";

const app = new Hono<{ Bindings: Env }>();

app.use("*", cors());

app.use("*", async (c, next) => {
  const start = Date.now();
  await next();
  const log = createLogger({ component: "api" });
  log.info("request", {
    requestId: c.req.header("cf-ray"),
    method: c.req.method,
    path: c.req.path,
    status: c.res.status,
    durationMs: Date.now() - start,
  });
});

app.get("/health", (c) => {
  return c.json({ status: "ok", environment: c.env.ENVIRONMENT });
});

app.route("/v1", routes);

app.notFound((c) => {
  return c.json({ error: "Not found" }, 404);
});

app.onError((err, c) => {
  if (err instanceof HTTPException) {
    if (err.status >= 500) {
      captureApiException(c, err, {
        status: err.status,
      });
    }
    const res = err.getResponse();
    if (res.headers.get("content-type")?.includes("json")) {
      return res;
    }
    return c.json({ error: err.message }, err.status);
  }
  const log = createLogger({ component: "api" });
  log.error("unhandled error", {
    requestId: c.req.header("cf-ray"),
    method: c.req.method,
    path: c.req.path,
    error: err,
  });
  captureApiException(c, err, {
    status: 500,
  });
  return c.json({ error: "Internal server error" }, 500);
});

export default app;
