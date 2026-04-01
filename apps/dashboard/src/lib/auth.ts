import { createDb } from "@versioneer/db";
import { adminUsers, adminSessions, adminAccounts, adminVerifications } from "@versioneer/db";
import { betterAuth, type BetterAuthOptions } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { APIError, createAuthMiddleware } from "better-auth/api";
import { tanstackStartCookies } from "better-auth/tanstack-start";
import { env } from "cloudflare:workers";

export function createAuth(d1: D1Database) {
  const db = createDb(d1);
  const allowedEmails = (env.ALLOWED_ADMIN_EMAILS ?? "")
    .split(",")
    .map((e: string) => e.trim().toLowerCase())
    .filter(Boolean);

  return betterAuth({
    database: drizzleAdapter(db, {
      provider: "sqlite",
      schema: {
        user: adminUsers,
        session: adminSessions,
        account: adminAccounts,
        verification: adminVerifications,
      },
    }),
    basePath: "/api/auth",
    secret: env.BETTER_AUTH_SECRET,
    socialProviders: {
      github: {
        clientId: env.GITHUB_OAUTH_CLIENT_ID!,
        clientSecret: env.GITHUB_OAUTH_CLIENT_SECRET!,
      },
    },
    hooks: {
      after: createAuthMiddleware(async (ctx) => {
        if (allowedEmails.length > 0 && ctx.context?.newSession) {
          const email = ctx.context.newSession.user.email?.toLowerCase();
          if (!email || !allowedEmails.includes(email)) {
            throw new APIError("FORBIDDEN", {
              message: "Access restricted to authorized users",
            });
          }
        }
      }),
    },
    plugins: [tanstackStartCookies()],
  } satisfies BetterAuthOptions);
}
