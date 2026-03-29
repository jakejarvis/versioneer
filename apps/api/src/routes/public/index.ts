import { Hono } from "hono";

import type { Env } from "../../env";
import { appsRoutes } from "./apps";
import { feedbackRoutes } from "./feedback";
import { installRoutes } from "./install";
import { inventoryRoutes } from "./inventory";

export const publicRoutes = new Hono<{ Bindings: Env }>()
  .route("/", inventoryRoutes)
  .route("/", appsRoutes)
  .route("/", installRoutes)
  .route("/", feedbackRoutes);
