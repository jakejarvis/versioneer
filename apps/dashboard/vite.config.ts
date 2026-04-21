import { cloudflare } from "@cloudflare/vite-plugin";
import tailwindcss from "@tailwindcss/vite";
import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import { defineConfig, lazyPlugins } from "vite-plus";

const appPlugins =
  process.env.VITEST === "true"
    ? []
    : lazyPlugins(() => [
        cloudflare({
          viteEnvironment: { name: "ssr" },
          auxiliaryWorkers: [{ configPath: "../worker/wrangler.jsonc" }],
          inspectorPort: 9231,
          persistState: { path: "../../.wrangler/state" },
        }),
        tanstackStart(),
      ]);

export default defineConfig({
  plugins: [tailwindcss(), ...(appPlugins ?? [])],
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
