import path from "node:path";

import { cloudflareTest, readD1Migrations } from "@cloudflare/vitest-pool-workers";
import { defineConfig } from "vitest/config";

export default defineConfig(async () => {
  const migrationsPath = path.resolve(__dirname, "../../packages/db/migrations");
  const migrations = await readD1Migrations(migrationsPath);

  return {
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
  };
});
