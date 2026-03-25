import { Hono } from "hono";
import { cors } from "hono/cors";

import type { Env } from "./env";
import { internalRoutes } from "./routes/internal";
import { publicRoutes } from "./routes/public";

const app = new Hono<{ Bindings: Env }>();

app.use("*", async (c, next) => {
  const handler = cors({
    origin: c.env.ADMIN_ORIGIN || "*",
    credentials: true,
  });
  return handler(c, next);
});

app.get("/health", (c) => {
  return c.json({ status: "ok", environment: c.env.ENVIRONMENT });
});

app.route("/v1", publicRoutes);
app.route("/internal", internalRoutes);

app.notFound((c) => {
  return c.json({ error: "Not found" }, 404);
});

app.onError((err, c) => {
  console.error("Unhandled error:", err);
  return c.json({ error: "Internal server error" }, 500);
});

export default app;
