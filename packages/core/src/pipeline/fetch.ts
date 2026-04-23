import { and, desc, eq, isNotNull, ne } from "drizzle-orm";

import { createDb } from "@versioneer/db";
import { sources, sourceFetches, generateId, idPrefixes } from "@versioneer/db";

import { createLogger } from "../logger";
import { getDescriptor } from "../sources/registry";
import type { SourceTypeDescriptor } from "../sources/types";
import { recordSourceAnomaly } from "./anomalies";
import { readResponseTextLimited, ResponseBodyTooLargeError } from "./response-body";
import { computeNextPollAt } from "./source-polling";
import {
  assertValidSourceFetchUrl,
  getSourceFetchUrlMetadata,
  isGitHubApiUrl,
  resolvePublicDnsAddresses,
  SourceUrlPolicyError,
} from "./source-url-policy";
import type { SourceFetchFailureReason, SourceFetchUrlMetadata } from "./source-url-policy";
import type { FetchStepResult, SourceFetchEnv, SourceFetchJob } from "./types";

const MAX_SOURCE_FETCH_BODY_BYTES = 5 * 1024 * 1024;
const SOURCE_FETCH_TIMEOUT_MS = 30_000;

async function deterministicSourceFetchId(sourceId: string, idempotencyKey?: string) {
  if (!idempotencyKey) return generateId(idPrefixes.sourceFetch);

  const encoder = new TextEncoder();
  const hashBuffer = await crypto.subtle.digest(
    "SHA-256",
    encoder.encode(`${sourceId}:${idempotencyKey}`),
  );
  const digest = [...new Uint8Array(hashBuffer)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
  return `${idPrefixes.sourceFetch}_${digest.slice(0, 20)}`;
}

interface SourceFetchResponse {
  response: Response;
  metadata: SourceFetchUrlMetadata;
}

class SourceFetchAttemptError extends Error {
  constructor(
    readonly metadata: SourceFetchUrlMetadata,
    readonly reason: SourceFetchFailureReason,
    message: string,
    options?: { cause?: unknown },
  ) {
    super(message, options);
    this.name = "SourceFetchAttemptError";
  }
}

async function fetchWithCandidates(
  descriptor: SourceTypeDescriptor,
  baseUrl: string,
  conditionalHeaders: Record<string, string>,
  env: SourceFetchEnv,
): Promise<SourceFetchResponse> {
  const candidates = descriptor.buildFetchUrls(baseUrl);
  if (candidates.length === 0) {
    throw new Error("No fetch URLs for source");
  }

  let lastResult: SourceFetchResponse | undefined;
  for (const candidate of candidates) {
    const metadata = getSourceFetchUrlMetadata(candidate);
    let url: URL;
    try {
      url = await assertValidSourceFetchUrl(candidate, {
        resolveAddresses: env.resolveSourceHostAddresses ?? resolvePublicDnsAddresses,
      });
    } catch (error) {
      if (error instanceof SourceUrlPolicyError) {
        throw new SourceFetchAttemptError(metadata, error.reason, error.message, {
          cause: error,
        });
      }
      throw error;
    }

    const headers = {
      ...descriptor.fetchHeaders({
        githubToken: isGitHubApiUrl(candidate) ? env.GITHUB_TOKEN : undefined,
      }),
      ...conditionalHeaders,
    };

    let response: Response;
    try {
      response = await fetch(candidate, {
        headers,
        signal: AbortSignal.timeout(SOURCE_FETCH_TIMEOUT_MS),
      });
    } catch (error) {
      const isTimeout = error instanceof DOMException && error.name === "TimeoutError";
      throw new SourceFetchAttemptError(
        { ...metadata, url },
        isTimeout ? "timeout" : "network_error",
        isTimeout
          ? `Source fetch timed out after ${SOURCE_FETCH_TIMEOUT_MS / 1000} s`
          : error instanceof Error
            ? error.message
            : "Source fetch network error",
        { cause: error },
      );
    }

    lastResult = { response, metadata: { ...metadata, url } };
    if (response.ok || response.status === 304) return lastResult;
  }

  return lastResult!;
}

function sourceFetchMetadataValues(metadata?: SourceFetchUrlMetadata | null) {
  return {
    fetchUrl: metadata?.rawUrl ?? null,
    fetchHostname: metadata?.hostname ?? null,
    fetchScheme: metadata?.scheme ?? null,
  };
}

async function recordNewFetchHostnameAnomaly(params: {
  db: ReturnType<typeof createDb>;
  sourceId: string;
  hostname: string | null;
  fetchId: string;
  now: string;
}) {
  if (!params.hostname) return;

  const existingHostname = await params.db
    .select({ id: sourceFetches.id })
    .from(sourceFetches)
    .where(
      and(
        eq(sourceFetches.sourceId, params.sourceId),
        eq(sourceFetches.fetchHostname, params.hostname),
        ne(sourceFetches.id, params.fetchId),
      ),
    )
    .limit(1)
    .get();
  if (existingHostname) return;

  const priorHostname = await params.db
    .select({ id: sourceFetches.id })
    .from(sourceFetches)
    .where(
      and(
        eq(sourceFetches.sourceId, params.sourceId),
        isNotNull(sourceFetches.fetchHostname),
        ne(sourceFetches.id, params.fetchId),
      ),
    )
    .limit(1)
    .get();
  if (!priorHostname) return;

  await recordSourceAnomaly({
    db: params.db,
    sourceId: params.sourceId,
    kind: "new_fetch_hostname",
    fingerprint: params.hostname,
    message: `Source fetched from new hostname: ${params.hostname}`,
    now: params.now,
  });
}

export async function handleSourceFetch(
  job: SourceFetchJob,
  env: SourceFetchEnv,
): Promise<FetchStepResult> {
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

  const descriptor = getDescriptor(source.sourceType);
  const nextPollAt = computeNextPollAt({
    baseTime: now,
    pollIntervalMinutes: source.pollIntervalMinutes,
    now,
  });

  if (!source.baseUrl && !descriptor.skipsFetch) {
    throw new Error(`Source ${job.sourceId} has no base URL`);
  }

  const fetchId = await deterministicSourceFetchId(source.id, job.idempotencyKey);
  if (job.idempotencyKey) {
    const existingFetch = await db
      .select()
      .from(sourceFetches)
      .where(eq(sourceFetches.id, fetchId))
      .get();

    if (existingFetch) {
      log.info("returning existing fetch for idempotency key", {
        fetchId,
        fetchStatus: existingFetch.fetchStatus,
      });
      if (existingFetch.fetchStatus === "error" || existingFetch.fetchStatus === "timeout") {
        throw new Error(existingFetch.errorMessage ?? `Source fetch failed: ${fetchId}`);
      }
      return {
        sourceFetchId: existingFetch.id,
        shouldParse: existingFetch.fetchStatus === "success" && !!existingFetch.r2Key,
        appId: source.appId,
      };
    }
  }

  // Sources that skip HTTP fetch (e.g. manual)
  if (descriptor.skipsFetch) {
    await db.insert(sourceFetches).values({
      id: fetchId,
      sourceId: source.id,
      fetchStatus: "success",
      fetchedAt: now,
    });
    await db
      .update(sources)
      .set({
        lastFetchedAt: now,
        lastSuccessAt: now,
        nextPollAt,
        updatedAt: now,
      })
      .where(eq(sources.id, source.id));
    return { sourceFetchId: fetchId, shouldParse: false, appId: source.appId };
  }

  // Perform HTTP fetch
  let lastFetchMetadata: SourceFetchUrlMetadata | null = null;
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

    const fetchResult = await fetchWithCandidates(
      descriptor,
      source.baseUrl!,
      conditionalHeaders,
      env,
    );
    const { response, metadata } = fetchResult;
    lastFetchMetadata = metadata;
    const metadataValues = sourceFetchMetadataValues(metadata);

    if (response.status === 304) {
      log.info("not modified", { fetchId });
      await db.insert(sourceFetches).values({
        id: fetchId,
        sourceId: source.id,
        fetchStatus: "not_modified",
        httpStatus: 304,
        etag: response.headers.get("etag"),
        lastModified: response.headers.get("last-modified"),
        ...metadataValues,
        fetchedAt: now,
      });
      await recordNewFetchHostnameAnomaly({
        db,
        sourceId: source.id,
        hostname: metadata.hostname,
        fetchId,
        now,
      });

      await db
        .update(sources)
        .set({ lastFetchedAt: now, lastSuccessAt: now, nextPollAt, updatedAt: now })
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
        failureReason: "http_error",
        ...metadataValues,
        fetchedAt: now,
      });
      await recordNewFetchHostnameAnomaly({
        db,
        sourceId: source.id,
        hostname: metadata.hostname,
        fetchId,
        now,
      });

      await db
        .update(sources)
        .set({ lastFetchedAt: now, lastFailureAt: now, nextPollAt, updatedAt: now })
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
      ...metadataValues,
      fetchedAt: now,
    });

    await recordNewFetchHostnameAnomaly({
      db,
      sourceId: source.id,
      hostname: metadata.hostname,
      fetchId,
      now,
    });

    await db
      .update(sources)
      .set({
        lastFetchedAt: now,
        lastSuccessAt: now,
        nextPollAt,
        status: "active",
        updatedAt: now,
      })
      .where(eq(sources.id, source.id));

    log.info("fetch completed", { fetchId, httpStatus: response.status, contentLength: bytesRead });
    return { sourceFetchId: fetchId, shouldParse: true, appId: source.appId };
  } catch (error) {
    log.error("fetch failed", { fetchId, error });
    const errorMsg = error instanceof Error ? error.message : String(error);
    const attemptError = error instanceof SourceFetchAttemptError ? error : null;
    const failureReason: SourceFetchFailureReason =
      attemptError?.reason ??
      (error instanceof ResponseBodyTooLargeError ? "body_limit" : "network_error");
    const metadataValues = sourceFetchMetadataValues(attemptError?.metadata ?? lastFetchMetadata);

    const existingFetch = await db
      .select({ id: sourceFetches.id })
      .from(sourceFetches)
      .where(eq(sourceFetches.id, fetchId))
      .get();

    if (!existingFetch) {
      await db.insert(sourceFetches).values({
        id: fetchId,
        sourceId: source.id,
        fetchStatus: failureReason === "timeout" ? "timeout" : "error",
        errorMessage: errorMsg,
        failureReason,
        ...metadataValues,
        fetchedAt: now,
      });
    }

    if (
      attemptError &&
      !["timeout", "network_error", "body_limit", "http_error"].includes(attemptError.reason)
    ) {
      await recordSourceAnomaly({
        db,
        sourceId: source.id,
        kind: "blocked_fetch_url",
        fingerprint: `${attemptError.reason}:${attemptError.metadata.rawUrl}`,
        message: `Blocked source fetch URL (${attemptError.reason}): ${attemptError.metadata.rawUrl}`,
        now,
      });
    }

    await db
      .update(sources)
      .set({ lastFetchedAt: now, lastFailureAt: now, nextPollAt, updatedAt: now })
      .where(eq(sources.id, source.id));

    throw error;
  }
}
