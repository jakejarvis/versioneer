import posthog from "@posthog/rollup-plugin";
import babel from "@rolldown/plugin-babel";
import tailwindcss from "@tailwindcss/vite";
import { tanstackRouter } from "@tanstack/router-plugin/vite";
import react, { reactCompilerPreset } from "@vitejs/plugin-react";
import { defineConfig } from "vite-plus";

export default defineConfig({
  plugins: [
    tanstackRouter({
      target: "react",
      autoCodeSplitting: true,
    }),
    react(),
    babel({
      presets: [reactCompilerPreset()],
    }),
    tailwindcss(),
    process.env.NODE_ENV === "production" &&
    process.env.POSTHOG_API_KEY &&
    process.env.POSTHOG_PROJECT_ID
      ? posthog({
          personalApiKey: process.env.POSTHOG_API_KEY,
          projectId: process.env.POSTHOG_PROJECT_ID,
          host: process.env.POSTHOG_HOST || "https://us.i.posthog.com",
          sourcemaps: {
            enabled: true,
            releaseName: "@versioneer/web",
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
    port: 5174,
  },
});
