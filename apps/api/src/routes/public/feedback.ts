import { zValidator } from "@hono/zod-validator";
import { createDb } from "@versioneer/db";
import { clientFeedback, generateId, idPrefixes } from "@versioneer/schema";
import { clientFeedbackSubmitSchema } from "@versioneer/validation";
import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";

import type { Env } from "../../env";

export const feedbackRoutes = new Hono<{ Bindings: Env }>()
  // POST /v1/feedback
  .post(
    "/feedback",
    zValidator("json", clientFeedbackSubmitSchema, (result) => {
      if (!result.success) {
        throw new HTTPException(400, {
          res: Response.json(
            { error: "Invalid request", details: result.error.issues },
            { status: 400 },
          ),
        });
      }
    }),
    async (c) => {
      const data = c.req.valid("json");
      const db = createDb(c.env.DB);
      const now = new Date().toISOString();

      const feedbackId = generateId(idPrefixes.feedback);

      await db.insert(clientFeedback).values({
        id: feedbackId,
        feedbackType: data.feedbackType,
        targetAppId: data.matchedAppId ?? null,
        bundleId: data.bundleId ?? null,
        appName: data.appName ?? null,
        payloadJson: data.payload ? JSON.stringify(data.payload) : null,
        status: "new",
        createdAt: now,
      });

      return c.json({ id: feedbackId, status: "received" });
    },
  );
