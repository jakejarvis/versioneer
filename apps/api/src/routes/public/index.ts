import { Hono } from "hono";

import type { Env } from "../../env";
import { appsRoutes } from "./apps";
import { feedbackRoutes } from "./feedback";
import { inventoryRoutes } from "./inventory";

export const publicRoutes = new Hono<{ Bindings: Env }>()
  .route("/", inventoryRoutes)
  .route("/", appsRoutes)
  .route("/", feedbackRoutes);
