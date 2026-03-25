import { defineConfig } from "drizzle-kit";

export default defineConfig({
  schema: "../schema/src/*.ts",
  out: "./migrations",
  dialect: "sqlite",
});
