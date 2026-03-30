import { createLogger } from "@versioneer/core/logger";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { HTTPException } from "hono/http-exception";

import { publicRoutes } from "./routes/public/index";

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

app.route("/v1", publicRoutes);

app.notFound((c) => {
  return c.json({ error: "Not found" }, 404);
});

app.onError((err, c) => {
  if (err instanceof HTTPException) {
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
  return c.json({ error: "Internal server error" }, 500);
});

export default app;
