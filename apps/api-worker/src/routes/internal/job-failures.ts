import { createDb } from "@versioneer/db";
import { jobFailures } from "@versioneer/schema";
import { paginationSchema } from "@versioneer/validation";
import { eq, sql, desc } from "drizzle-orm";
import { Hono } from "hono";

import type { AppEnv } from "../../env";

export const jobFailuresRoutes = new Hono<AppEnv>();

// GET /job-failures - list
jobFailuresRoutes.get("/", async (c) => {
  const db = createDb(c.env.DB);
  const { limit, offset } = paginationSchema.parse({
    limit: c.req.query("limit"),
    offset: c.req.query("offset"),
  });
  const status = c.req.query("status") ?? "open";

  const [countResult] = await db
    .select({ count: sql<number>`count(*)` })
    .from(jobFailures)
    .where(eq(jobFailures.status, status as "open" | "retrying" | "resolved" | "abandoned"));
  const items = await db
    .select()
    .from(jobFailures)
    .where(eq(jobFailures.status, status as "open" | "retrying" | "resolved" | "abandoned"))
    .orderBy(desc(jobFailures.createdAt))
    .limit(limit)
    .offset(offset);

  return c.json({ items, total: countResult?.count ?? 0, limit, offset });
});

// GET /job-failures/:id
jobFailuresRoutes.get("/:id", async (c) => {
  const db = createDb(c.env.DB);
  const id = c.req.param("id");
  const item = await db.select().from(jobFailures).where(eq(jobFailures.id, id)).get();
  if (!item) return c.json({ error: "Job failure not found" }, 404);
  return c.json(item);
});

// PATCH /job-failures/:id - update status
jobFailuresRoutes.patch("/:id", async (c) => {
  const id = c.req.param("id");
  const body = await c.req.json();
  const newStatus = (body as Record<string, string>).status;

  if (!newStatus || !["resolved", "abandoned", "retrying"].includes(newStatus)) {
    return c.json({ error: "Invalid status" }, 400);
  }

  const db = createDb(c.env.DB);
  const existing = await db.select().from(jobFailures).where(eq(jobFailures.id, id)).get();
  if (!existing) return c.json({ error: "Job failure not found" }, 404);

  const now = new Date().toISOString();
  const updates: Record<string, unknown> = { status: newStatus };
  if (newStatus === "resolved" || newStatus === "abandoned") {
    updates.resolvedAt = now;
  }

  await db.update(jobFailures).set(updates).where(eq(jobFailures.id, id));

  return c.json({ status: "updated" });
});

// POST /job-failures/:id/retry - re-enqueue
jobFailuresRoutes.post("/:id/retry", async (c) => {
  const id = c.req.param("id");
  const db = createDb(c.env.DB);
  const failure = await db.select().from(jobFailures).where(eq(jobFailures.id, id)).get();
  if (!failure) return c.json({ error: "Job failure not found" }, 404);

  // Re-enqueue based on job type
  switch (failure.jobType) {
    case "source-fetch":
      if (failure.relatedId) {
        await c.env.SOURCE_FETCH_QUEUE.send({
          sourceId: failure.relatedId,
          reason: "retry",
          force: true,
        });
      }
      break;
    case "source-parse":
      if (failure.relatedId) {
        await c.env.SOURCE_PARSE_QUEUE.send({ sourceFetchId: failure.relatedId });
      }
      break;
    case "artifact-verify":
      if (failure.relatedId) {
        await c.env.ARTIFACT_VERIFY_QUEUE.send({ artifactId: failure.relatedId });
      }
      break;
    case "recompute-latest":
      if (failure.relatedId) {
        await c.env.RECOMPUTE_LATEST_QUEUE.send({ appId: failure.relatedId });
      }
      break;
  }

  await db.update(jobFailures).set({ status: "retrying" }).where(eq(jobFailures.id, id));

  return c.json({ status: "retrying" });
});

// POST /job-failures/retry-all - re-enqueue all open failures of a given type
jobFailuresRoutes.post("/retry-all", async (c) => {
  const body = await c.req.json();
  const jobType = (body as Record<string, string>).jobType;

  const db = createDb(c.env.DB);
  const failures = await db.select().from(jobFailures).where(eq(jobFailures.status, "open")).all();

  const matching = jobType ? failures.filter((f) => f.jobType === jobType) : failures;
  let retried = 0;

  for (const failure of matching) {
    switch (failure.jobType) {
      case "source-fetch":
        if (failure.relatedId) {
          await c.env.SOURCE_FETCH_QUEUE.send({
            sourceId: failure.relatedId,
            reason: "retry",
            force: true,
          });
          retried++;
        }
        break;
      case "source-parse":
        if (failure.relatedId) {
          await c.env.SOURCE_PARSE_QUEUE.send({ sourceFetchId: failure.relatedId });
          retried++;
        }
        break;
      case "artifact-verify":
        if (failure.relatedId) {
          await c.env.ARTIFACT_VERIFY_QUEUE.send({ artifactId: failure.relatedId });
          retried++;
        }
        break;
      case "recompute-latest":
        if (failure.relatedId) {
          await c.env.RECOMPUTE_LATEST_QUEUE.send({ appId: failure.relatedId });
          retried++;
        }
        break;
    }
    await db.update(jobFailures).set({ status: "retrying" }).where(eq(jobFailures.id, failure.id));
  }

  return c.json({ status: "retrying", count: retried });
});
