import { createDb } from "@versioneer/db";
import { sources, sourceFetches, generateId, idPrefixes } from "@versioneer/schema";
import { eq } from "drizzle-orm";

import { incrementHealthMetric } from "./health";
import type { Env, SourceFetchJob } from "./types";

export async function handleSourceFetch(job: SourceFetchJob, env: Env): Promise<void> {
  const db = createDb(env.DB);
  const now = new Date().toISOString();

  // Load source
  const source = await db.select().from(sources).where(eq(sources.id, job.sourceId)).get();
  if (!source) {
    throw new Error(`Source not found: ${job.sourceId}`);
  }

  if (source.status === "disabled" && !job.force) {
    return;
  }

  if (!source.baseUrl && source.sourceType !== "manual") {
    throw new Error(`Source ${job.sourceId} has no base URL`);
  }

  const fetchId = generateId(idPrefixes.sourceFetch);

  // For manual sources, skip HTTP fetch
  if (source.sourceType === "manual") {
    await db.insert(sourceFetches).values({
      id: fetchId,
      sourceId: source.id,
      fetchStatus: "success",
      fetchedAt: now,
    });
    return;
  }

  // Perform HTTP fetch
  try {
    const headers: Record<string, string> = {};
    if (source.sourceType === "github_releases") {
      headers["Accept"] = "application/vnd.github.v3+json";
      headers["User-Agent"] = "Versioneer/1.0 (https://versioneer.app)";
    }

    // Use etag/last-modified for conditional requests
    const lastFetch = await db
      .select()
      .from(sourceFetches)
      .where(eq(sourceFetches.sourceId, source.id))
      .orderBy(sourceFetches.fetchedAt)
      .limit(1)
      .get();

    if (!job.force && lastFetch) {
      if (lastFetch.etag) headers["If-None-Match"] = lastFetch.etag;
      if (lastFetch.lastModified) headers["If-Modified-Since"] = lastFetch.lastModified;
    }

    const response = await fetch(source.baseUrl!, { headers });

    if (response.status === 304) {
      await db.insert(sourceFetches).values({
        id: fetchId,
        sourceId: source.id,
        fetchStatus: "not_modified",
        httpStatus: 304,
        etag: response.headers.get("etag"),
        lastModified: response.headers.get("last-modified"),
        fetchedAt: now,
      });

      await db
        .update(sources)
        .set({ lastFetchedAt: now, lastSuccessAt: now, updatedAt: now })
        .where(eq(sources.id, source.id));

      return;
    }

    if (!response.ok) {
      const errorMsg = `HTTP ${response.status}: ${response.statusText}`;
      await db.insert(sourceFetches).values({
        id: fetchId,
        sourceId: source.id,
        fetchStatus: "error",
        httpStatus: response.status,
        errorMessage: errorMsg,
        fetchedAt: now,
      });

      await db
        .update(sources)
        .set({ lastFetchedAt: now, lastFailureAt: now, updatedAt: now })
        .where(eq(sources.id, source.id));

      return;
    }

    // Store raw body in R2
    const body = await response.text();
    const dateObj = new Date(now);
    const yyyy = dateObj.getUTCFullYear();
    const mm = String(dateObj.getUTCMonth() + 1).padStart(2, "0");
    const dd = String(dateObj.getUTCDate()).padStart(2, "0");
    const r2Key = `source-fetches/${source.id}/${yyyy}/${mm}/${dd}/${fetchId}.body`;

    await env.RAW_BUCKET.put(r2Key, body);

    // Also store response headers
    const headersKey = `source-fetches/${source.id}/${yyyy}/${mm}/${dd}/${fetchId}.headers.json`;
    const responseHeaders: Record<string, string> = {};
    response.headers.forEach((value, key) => {
      responseHeaders[key] = value;
    });
    await env.RAW_BUCKET.put(headersKey, JSON.stringify(responseHeaders));

    // Compute simple content hash
    const encoder = new TextEncoder();
    const hashBuffer = await crypto.subtle.digest("SHA-256", encoder.encode(body));
    const contentHash = [...new Uint8Array(hashBuffer)]
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("");

    await db.insert(sourceFetches).values({
      id: fetchId,
      sourceId: source.id,
      fetchStatus: "success",
      httpStatus: response.status,
      etag: response.headers.get("etag"),
      lastModified: response.headers.get("last-modified"),
      contentType: response.headers.get("content-type"),
      contentLength: body.length,
      contentHash,
      r2Key,
      fetchedAt: now,
    });

    await db
      .update(sources)
      .set({
        lastFetchedAt: now,
        lastSuccessAt: now,
        status: "active",
        updatedAt: now,
      })
      .where(eq(sources.id, source.id));

    // Track health metric: success
    await incrementHealthMetric(db, source.id, "fetchAttempts");
    await incrementHealthMetric(db, source.id, "fetchSuccesses");

    // Enqueue parse job
    await env.SOURCE_PARSE_QUEUE.send({ sourceFetchId: fetchId });
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);

    await db.insert(sourceFetches).values({
      id: fetchId,
      sourceId: source.id,
      fetchStatus: "error",
      errorMessage: errorMsg,
      fetchedAt: now,
    });

    await db
      .update(sources)
      .set({ lastFetchedAt: now, lastFailureAt: now, updatedAt: now })
      .where(eq(sources.id, source.id));

    // Track health metric: failure
    await incrementHealthMetric(db, source.id, "fetchAttempts");
    await incrementHealthMetric(db, source.id, "fetchFailures");

    throw error;
  }
}
