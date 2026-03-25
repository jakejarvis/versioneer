import { Hono } from "hono";

import type { Env } from "../../env";
import { aliasesRoutes } from "./aliases";
import { appsRoutes } from "./apps";
import { auditLogRoutes } from "./audit-log";
import { installRulesRoutes } from "./install-rules";
import { jobFailuresRoutes } from "./job-failures";
import { onboardingRoutes } from "./onboarding";
import { overridesRoutes } from "./overrides";
import { releasesRoutes } from "./releases";
import { reviewQueueRoutes } from "./review-queue";
import { scorecardsRoutes } from "./scorecards";
import { sourcesRoutes } from "./sources";
import { statsRoutes } from "./stats";

export const internalRoutes = new Hono<{ Bindings: Env }>();

internalRoutes.route("/stats", statsRoutes);
internalRoutes.route("/apps", appsRoutes);
internalRoutes.route("/aliases", aliasesRoutes);
internalRoutes.route("/sources", sourcesRoutes);
internalRoutes.route("/releases", releasesRoutes);
internalRoutes.route("/review-queue", reviewQueueRoutes);
internalRoutes.route("/job-failures", jobFailuresRoutes);
internalRoutes.route("/overrides", overridesRoutes);
internalRoutes.route("/audit-log", auditLogRoutes);
internalRoutes.route("/install-rules", installRulesRoutes);
internalRoutes.route("/scorecards", scorecardsRoutes);
internalRoutes.route("/onboarding", onboardingRoutes);

// Recompute latest (kept at top level for backwards compat)
internalRoutes.post("/apps/:id/recompute-latest", async (c) => {
  const appId = c.req.param("id");
  const body = await c.req.json().catch(() => ({}));
  const channel = (body as Record<string, string>).channel;
  await c.env.RECOMPUTE_LATEST_QUEUE.send({ appId, channel });
  return c.json({ status: "queued", appId });
});
