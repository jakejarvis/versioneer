import { Hono } from "hono";

import type { AppEnv } from "../../env";

export const authRoutes = new Hono<AppEnv>();

authRoutes.get("/me", (c) => {
  const user = c.get("user");
  return c.json({ email: user.email });
});
