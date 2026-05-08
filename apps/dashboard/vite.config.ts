import { cloudflare } from "@cloudflare/vite-plugin";
import tailwindcss from "@tailwindcss/vite";
import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import react from "@vitejs/plugin-react";
import { defineConfig, lazyPlugins } from "vite-plus";

export default defineConfig({
  plugins: [
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
    react(),
    tailwindcss(),
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
