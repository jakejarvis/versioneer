import { createDb } from "@versioneer/db";
import { sources, sourceFetches, generateId, idPrefixes } from "@versioneer/db";
import type { SourceType } from "@versioneer/schemas/sources";
import { desc, eq } from "drizzle-orm";

import { createLogger } from "../logger";
import { getDescriptor } from "../sources/registry";
import type { SourceTypeDescriptor } from "../sources/types";
import { readResponseTextLimited } from "./response-body";
import type { Env, FetchStepResult, SourceFetchJob } from "./types";

const MAX_SOURCE_FETCH_BODY_BYTES = 5 * 1024 * 1024;

async function fetchWithCandidates(
  descriptor: SourceTypeDescriptor,
  baseUrl: string,
  conditionalHeaders: Record<string, string>,
  env: Env,
): Promise<Response> {
  const candidates = descriptor.buildFetchUrls(baseUrl);
  if (candidates.length === 0) {
    throw new Error("No fetch URLs for source");
  }

  const headers = {
    ...descriptor.fetchHeaders({ githubToken: env.GITHUB_TOKEN }),
    ...conditionalHeaders,
  };

  let lastResponse: Response | undefined;
  for (const candidate of candidates) {
    lastResponse = await fetch(candidate, { headers });
    if (lastResponse.ok || lastResponse.status === 304) return lastResponse;
  }

  return lastResponse!;
}

export async function handleSourceFetch(job: SourceFetchJob, env: Env): Promise<FetchStepResult> {
  const db = createDb(env.DB);
  const log = createLogger({ fn: "handleSourceFetch", sourceId: job.sourceId });
  const now = new Date().toISOString();

  // Load source
  const source = await db.select().from(sources).where(eq(sources.id, job.sourceId)).get();
  if (!source) {
    throw new Error(`Source not found: ${job.sourceId}`);
  }

  if (source.status === "disabled" && !job.force) {
    log.info("source disabled, skipping");
    return { sourceFetchId: null, shouldParse: false, appId: source.appId };
  }

  const descriptor = getDescriptor(source.sourceType as SourceType);

  if (!source.baseUrl && !descriptor.skipsFetch) {
    throw new Error(`Source ${job.sourceId} has no base URL`);
  }

  const fetchId = generateId(idPrefixes.sourceFetch);

  // Sources that skip HTTP fetch (e.g. manual)
  if (descriptor.skipsFetch) {
    await db.insert(sourceFetches).values({
      id: fetchId,
      sourceId: source.id,
      fetchStatus: "success",
      fetchedAt: now,
    });
    return { sourceFetchId: fetchId, shouldParse: false, appId: source.appId };
  }

  // Perform HTTP fetch
  try {
    // Use etag/last-modified for conditional requests
    const conditionalHeaders: Record<string, string> = {};
    const lastFetch = await db
      .select()
      .from(sourceFetches)
      .where(eq(sourceFetches.sourceId, source.id))
      .orderBy(desc(sourceFetches.fetchedAt))
      .limit(1)
      .get();

    if (!job.force && lastFetch) {
      if (lastFetch.etag) conditionalHeaders["If-None-Match"] = lastFetch.etag;
      if (lastFetch.lastModified) conditionalHeaders["If-Modified-Since"] = lastFetch.lastModified;
    }

    const response = await fetchWithCandidates(
      descriptor,
      source.baseUrl!,
      conditionalHeaders,
      env,
    );

    if (response.status === 304) {
      log.info("not modified", { fetchId });
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

      return { sourceFetchId: fetchId, shouldParse: false, appId: source.appId };
    }

    if (!response.ok) {
      const errorMsg = `HTTP ${response.status}: ${response.statusText}`;
      log.warn("fetch returned error status", { fetchId, httpStatus: response.status });
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

      return { sourceFetchId: fetchId, shouldParse: false, appId: source.appId };
    }

    // Store raw body in R2
    const { text: body, bytesRead } = await readResponseTextLimited(
      response,
      MAX_SOURCE_FETCH_BODY_BYTES,
    );
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
      contentLength: bytesRead,
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

    log.info("fetch completed", { fetchId, httpStatus: response.status, contentLength: bytesRead });
    return { sourceFetchId: fetchId, shouldParse: true, appId: source.appId };
  } catch (error) {
    log.error("fetch failed", { fetchId, error });
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

    throw error;
  }
}
