import * as schema from "@macupdater/schema";
import { drizzle } from "drizzle-orm/d1";

export type Database = ReturnType<typeof createDb>;

export function createDb(d1: D1Database) {
  return drizzle(d1, { schema });
}
