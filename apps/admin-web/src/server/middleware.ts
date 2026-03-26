import { createMiddleware } from "@tanstack/react-start";

export const authMiddleware = createMiddleware().server(async ({ next, request }) => {
  const email = request.headers.get("Cf-Access-Authenticated-User-Email") || "dev@localhost";
  return next({ context: { user: { email } } });
});
