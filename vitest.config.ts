import { defineConfig } from "vitest/config";
import path from "path";

export default defineConfig({
  test: {
    globals: true,
    environment: "node",
  },
  resolve: {
    alias: {
      "@macupdater/schema": path.resolve(__dirname, "packages/schema/src"),
      "@macupdater/db": path.resolve(__dirname, "packages/db/src"),
      "@macupdater/validation": path.resolve(__dirname, "packages/validation/src"),
      "@macupdater/identity": path.resolve(__dirname, "packages/identity/src"),
      "@macupdater/versioning": path.resolve(__dirname, "packages/versioning/src"),
      "@macupdater/parsers": path.resolve(__dirname, "packages/parsers/src"),
      "@macupdater/pipeline": path.resolve(__dirname, "packages/pipeline/src"),
      "@macupdater/cache": path.resolve(__dirname, "packages/cache/src"),
      "@macupdater/api-contracts": path.resolve(__dirname, "packages/api-contracts/src"),
    },
  },
});
