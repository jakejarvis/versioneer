import { sqliteTable, text, integer, uniqueIndex } from "drizzle-orm/sqlite-core";

export const deviceAttestations = sqliteTable(
  "device_attestations",
  {
    id: text("id").primaryKey(),
    keyId: text("key_id").notNull(),
    publicKey: text("public_key").notNull(),
    counter: integer("counter").notNull().default(0),
    receipt: text("receipt"),
    environment: text("environment"),
    createdAt: text("created_at").notNull(),
    lastUsedAt: text("last_used_at"),
  },
  (table) => [uniqueIndex("idx_device_attestations_key_id").on(table.keyId)],
);
