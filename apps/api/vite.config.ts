import { fileURLToPath, URL } from "node:url";

import { cloudflareTest, readD1Migrations } from "@cloudflare/vitest-pool-workers";
import { defineConfig } from "vite-plus";

const migrationsPath = fileURLToPath(new URL("../../packages/db/migrations", import.meta.url));
const migrations = await readD1Migrations(migrationsPath);
const rootPath = fileURLToPath(new URL(".", import.meta.url));

export default defineConfig({
  root: rootPath,
  resolve: {
    tsconfigPaths: true,
  },
  plugins: [
    cloudflareTest({
      main: "./src/index.ts",
      wrangler: { configPath: "./wrangler.jsonc" },
      miniflare: {
        bindings: { TEST_MIGRATIONS: migrations },
      },
    }),
  ],
  test: {
    globals: true,
    setupFiles: ["./src/__tests__/setup.ts"],
  },
});
