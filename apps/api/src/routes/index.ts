import { Hono } from "hono";

import { appsRoutes } from "./apps";
import { feedbackRoutes } from "./feedback";
import { installRoutes } from "./install";
import { inventoryRoutes } from "./inventory";
import { preflightRoutes } from "./preflight";
import { recentReleasesRoutes } from "./recent-releases";

export const routes = new Hono<{ Bindings: Env }>()
  .route("/", recentReleasesRoutes)
  .route("/", preflightRoutes)
  .route("/", inventoryRoutes)
  .route("/", appsRoutes)
  .route("/", installRoutes)
  .route("/", feedbackRoutes);
