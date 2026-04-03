import { Hono } from "hono";

import { requireAttestation } from "@/middleware/attestation";

import { appsRoutes } from "./apps";
import { attestRoutes } from "./attest";
import { feedbackRoutes } from "./feedback";
import { installRoutes } from "./install";
import { inventoryRoutes } from "./inventory";
import { recentReleasesRoutes } from "./recent-releases";

/** Routes that do NOT require App Attest authentication. */
export const openRoutes = new Hono<{ Bindings: Env }>()
  .route("/", attestRoutes)
  .route("/", recentReleasesRoutes);

/** Routes that require a valid App Attest JWT. */
export const protectedRoutes = new Hono<{ Bindings: Env }>();
protectedRoutes.use("*", requireAttestation);
protectedRoutes
  .route("/", inventoryRoutes)
  .route("/", appsRoutes)
  .route("/", installRoutes)
  .route("/", feedbackRoutes);
