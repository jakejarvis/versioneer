import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    projects: ["packages/versioning", "packages/parsers", "packages/identity", "packages/pipeline"],
  },
});
