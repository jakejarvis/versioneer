import { cloudflare } from "@cloudflare/vite-plugin";
import babel from "@rolldown/plugin-babel";
import tailwindcss from "@tailwindcss/vite";
import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import react, { reactCompilerPreset } from "@vitejs/plugin-react";
import { defineConfig, lazyPlugins } from "vite-plus";

export default defineConfig({
  plugins: [
    process.env.VITEST !== "true"
      ? lazyPlugins(() => [
          cloudflare({
            viteEnvironment: { name: "ssr" },
            inspectorPort: 9235,
            persistState: { path: "../../.wrangler/state" },
          }),
          tanstackStart({
            prerender: {
              enabled: true,
            },
          }),
        ])
      : [],
    react(),
    tailwindcss(),
    babel({
      presets: [reactCompilerPreset()],
    }),
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
