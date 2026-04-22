import { defineConfig } from "vite-plus";

export default defineConfig({
  test: {
    projects: ["apps/*", "packages/*"],
  },
  staged: {
    "*": "vp check --fix",
  },
  fmt: {
    sortImports: {
      groups: [
        "builtin",
        "external",
        ["internal", "subpath"],
        ["parent", "sibling", "index"],
        "style",
        "unknown",
      ],
      internalPattern: ["@/", "@versioneer/"],
      newlinesBetween: true,
      order: "asc",
    },
    overrides: [
      {
        files: ["**/*.json", "**/*.jsonc"],
        options: {
          trailingComma: "none",
        },
      },
    ],
    ignorePatterns: [
      "dist",
      "node_modules",
      ".vite-hooks",
      ".wrangler",
      ".tanstack",
      ".build",
      ".pnpm-store",
      "pnpm-lock.yaml",
      "**/routeTree.gen.ts",
      "**/worker-configuration.d.ts",
      "packages/db/migrations",
      "apps/desktop",
    ],
  },
  lint: {
    plugins: ["oxc", "eslint", "typescript", "react", "import", "unicorn", "vitest"],
    categories: {
      correctness: "error",
      suspicious: "warn",
      perf: "warn",
    },
    rules: {
      "import/no-named-as-default-member": "off",
      "import/no-unassigned-import": "off",
      "no-await-in-loop": "off",
      "no-console": "off",
      "no-new": "off",
      "no-unused-vars": "off",
      "oxc/no-barrel-file": "off",
      "react/no-unknown-property": "off",
      "react/react-in-jsx-scope": "off",
      "react/style-prop-object": "off",
      "typescript/no-base-to-string": "off",
      "typescript/no-misused-spread": "off",
      "typescript/no-redundant-type-constituents": "off",
      "typescript/no-unnecessary-type-assertion": "off",
      "typescript/no-unnecessary-type-parameters": "off",
      "typescript/no-unsafe-enum-comparison": "off",
      "typescript/no-unsafe-type-assertion": "off",
      "typescript/no-unused-vars": "warn",
      "unicorn/consistent-function-scoping": "off",
      "unicorn/filename-case": "off",
      "unicorn/no-array-sort": "off",
      "unicorn/no-null": "off",
    },
    overrides: [
      {
        files: ["**/*.test.ts", "**/*.test.tsx", "**/*.spec.ts"],
        rules: {
          "typescript/no-unused-vars": "off",
        },
      },
    ],
    ignorePatterns: [
      "dist",
      "node_modules",
      ".vite-hooks",
      ".wrangler",
      ".tanstack",
      ".build",
      ".pnpm-store",
      "**/routeTree.gen.ts",
      "**/worker-configuration.d.ts",
      "packages/db/migrations",
    ],
    options: {
      typeAware: true,
      typeCheck: true,
    },
  },
});
