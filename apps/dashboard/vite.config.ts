import { cloudflare } from "@cloudflare/vite-plugin";
import posthog from "@posthog/rollup-plugin";
import tailwindcss from "@tailwindcss/vite";
import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import { defineConfig, lazyPlugins } from "vite-plus";

export default defineConfig({
  plugins: [
    tailwindcss(),
    process.env.VITEST !== "true"
      ? lazyPlugins(() => [
          cloudflare({
            viteEnvironment: { name: "ssr" },
            auxiliaryWorkers: [{ configPath: "../worker/wrangler.jsonc" }],
            inspectorPort: 9231,
            persistState: { path: "../../.wrangler/state" },
          }),
          tanstackStart(),
        ])
      : [],
    process.env.NODE_ENV === "production" &&
    process.env.POSTHOG_API_KEY &&
    process.env.POSTHOG_PROJECT_ID
      ? posthog({
          personalApiKey: process.env.POSTHOG_API_KEY,
          projectId: process.env.POSTHOG_PROJECT_ID,
          host: process.env.POSTHOG_HOST || "https://us.i.posthog.com",
          sourcemaps: {
            enabled: true,
            releaseName: "@versioneer/dashboard",
            releaseVersion: process.env.GITHUB_SHA,
            deleteAfterUpload: false,
          },
        })
      : [],
  ],
  build: {
    sourcemap: true,
  },
  resolve: {
    tsconfigPaths: true,
  },
  server: {
    port: 5173,
  },
  test: {
    environment: "jsdom",
    setupFiles: ["./src/test/setup.ts"],
    include: ["src/**/*.test.ts", "src/**/*.test.tsx"],
  },
});
