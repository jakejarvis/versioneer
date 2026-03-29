import { defineConfig } from "drizzle-kit";

export default defineConfig({
  schema: "../schema/src/index.ts",
  out: "./migrations",
  dialect: "sqlite",
});
