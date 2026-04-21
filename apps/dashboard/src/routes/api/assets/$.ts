import { createFileRoute } from "@tanstack/react-router";
import { env } from "cloudflare:workers";

export const Route = createFileRoute("/api/assets/$")({
  server: {
    handlers: {
      GET: async ({ params }) => {
        const key = params._splat;
        if (!key) {
          return new Response("Not found", { status: 404 });
        }

        const object = await env.ASSETS_BUCKET.get(key);

        if (!object) {
          return new Response("Not found", { status: 404 });
        }

        return new Response(object.body as ReadableStream, {
          headers: {
            "Content-Type": object.httpMetadata?.contentType ?? "application/octet-stream",
            "Cache-Control": object.httpMetadata?.cacheControl ?? "public, max-age=86400",
          },
        });
      },
    },
  },
});
