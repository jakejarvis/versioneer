import { createServerFn } from "@tanstack/react-start";

import { authMiddleware } from "./middleware";

export const getMe = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .handler(async ({ context }) => {
    return { email: context.user.email };
  });
