import { createDb } from "@versioneer/db";
import { sources, auditLog, generateId, idPrefixes } from "@versioneer/schema";
import { toGitHubApiReleasesUrl } from "@versioneer/validation";
import { and, eq } from "drizzle-orm";

/** Minimum sighting count before auto-creating sources from discovered app metadata. */
export const AUTO_SOURCE_MIN_SIGHTINGS = 3;

interface DiscoveredAppRow {
  id: string;
  sightingCount: number;
  sparkleFeedUrl: string | null;
  electronUpdateUrl: string | null;
}

/**
 * Auto-creates source entries for a discovered app that has been approved.
 * Sources are created with status "paused" so an admin can review before activating.
 */
export async function autoCreateSourcesForDiscoveredApp(params: {
  discoveredApp: DiscoveredAppRow;
  appId: string;
  actorEmail: string;
  db: ReturnType<typeof createDb>;
}): Promise<{ created: string[] }> {
  const { discoveredApp, appId, actorEmail, db } = params;
  const created: string[] = [];

  if (discoveredApp.sightingCount < AUTO_SOURCE_MIN_SIGHTINGS) {
    return { created };
  }

  const now = new Date().toISOString();

  // Sparkle feed
  if (discoveredApp.sparkleFeedUrl) {
    const baseUrl = discoveredApp.sparkleFeedUrl;
    const existing = await db
      .select({ id: sources.id })
      .from(sources)
      .where(and(eq(sources.appId, appId), eq(sources.baseUrl, baseUrl)))
      .get();

    if (!existing) {
      const sourceId = generateId(idPrefixes.source);
      await db.insert(sources).values({
        id: sourceId,
        appId,
        sourceType: "sparkle",
        parserKey: "sparkle",
        baseUrl,
        label: "Auto: Sparkle feed",
        pollIntervalMinutes: 60,
        status: "paused",
        createdAt: now,
        updatedAt: now,
      });

      await db.insert(auditLog).values({
        id: generateId(idPrefixes.auditLog),
        eventType: "source_auto_created",
        actorType: "system",
        actorId: actorEmail,
        targetType: "source",
        targetId: sourceId,
        payloadJson: JSON.stringify({
          discoveredAppId: discoveredApp.id,
          url: baseUrl,
          sourceType: "sparkle",
        }),
        createdAt: now,
      });

      created.push(sourceId);
    }
  }

  // Electron / GitHub releases
  if (discoveredApp.electronUpdateUrl) {
    const apiUrl = toGitHubApiReleasesUrl(discoveredApp.electronUpdateUrl);
    if (apiUrl) {
      const existing = await db
        .select({ id: sources.id })
        .from(sources)
        .where(and(eq(sources.appId, appId), eq(sources.baseUrl, apiUrl)))
        .get();

      if (!existing) {
        const sourceId = generateId(idPrefixes.source);
        await db.insert(sources).values({
          id: sourceId,
          appId,
          sourceType: "github_releases",
          parserKey: "github_releases",
          baseUrl: apiUrl,
          label: "Auto: GitHub releases",
          pollIntervalMinutes: 60,
          status: "paused",
          createdAt: now,
          updatedAt: now,
        });

        await db.insert(auditLog).values({
          id: generateId(idPrefixes.auditLog),
          eventType: "source_auto_created",
          actorType: "system",
          actorId: actorEmail,
          targetType: "source",
          targetId: sourceId,
          payloadJson: JSON.stringify({
            discoveredAppId: discoveredApp.id,
            url: apiUrl,
            originalUrl: discoveredApp.electronUpdateUrl,
            sourceType: "github_releases",
          }),
          createdAt: now,
        });

        created.push(sourceId);
      }
    }
  }

  return { created };
}
