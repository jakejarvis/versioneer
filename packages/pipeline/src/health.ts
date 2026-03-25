import { createDb } from "@versioneer/db";
import { sourceHealthMetrics, generateId, idPrefixes } from "@versioneer/schema";
import { eq, and } from "drizzle-orm";

type HealthField =
  | "fetchAttempts"
  | "fetchSuccesses"
  | "fetchFailures"
  | "parseAttempts"
  | "parseSuccesses"
  | "parseFailures"
  | "reviewItemsCreated";

export async function incrementHealthMetric(
  db: ReturnType<typeof createDb>,
  sourceId: string,
  field: HealthField,
): Promise<void> {
  const now = new Date();
  const periodStart = now.toISOString().slice(0, 10); // YYYY-MM-DD

  const existing = await db
    .select()
    .from(sourceHealthMetrics)
    .where(
      and(
        eq(sourceHealthMetrics.sourceId, sourceId),
        eq(sourceHealthMetrics.periodStart, periodStart),
      ),
    )
    .get();

  if (existing) {
    const currentValue = existing[field] as number;
    await db
      .update(sourceHealthMetrics)
      .set({ [field]: currentValue + 1 })
      .where(eq(sourceHealthMetrics.id, existing.id));
  } else {
    await db.insert(sourceHealthMetrics).values({
      id: generateId(idPrefixes.sourceHealthMetric),
      sourceId,
      periodStart,
      [field]: 1,
      createdAt: now.toISOString(),
    });
  }
}
