import { createDb } from "@versioneer/db";
import {
  artifacts,
  releases,
  apps,
  appAliases,
  artifactObservations,
  generateId,
  idPrefixes,
} from "@versioneer/schema";
import { eq, and } from "drizzle-orm";

import type { Env, ArtifactVerifyJob } from "./types";

// DigestStream is a Cloudflare Workers API not present in DOM types.
// Declared here so the pipeline package typechecks when consumed by the dashboard.
declare class DigestStream extends WritableStream<Uint8Array> {
  constructor(algorithm: string);
  get digest(): Promise<ArrayBuffer>;
}

const MAX_DOWNLOAD_SIZE = 500 * 1024 * 1024; // 500 MB
const HEAD_TIMEOUT_MS = 30_000;
const DOWNLOAD_TIMEOUT_MS = 300_000; // 5 minutes
const USER_AGENT = "Versioneer/1.0 (https://versioneer.app)";

export interface VerificationResults {
  urlAccessible: boolean | null;
  sizeMatch: boolean | null;
  hashMatch: boolean | null;
  teamIdMatch: boolean | null;
}

export function computeTrustLevel(
  results: VerificationResults,
): "unknown" | "untrusted" | "low" | "medium" {
  // Any active failure → untrusted
  if (
    results.urlAccessible === false ||
    results.sizeMatch === false ||
    results.hashMatch === false ||
    results.teamIdMatch === false
  ) {
    return "untrusted";
  }

  // URL must be accessible for any positive trust signal
  if (results.urlAccessible !== true) {
    return "unknown";
  }

  // URL accessible + hash verified + team ID verified → medium (best from HTTP-only)
  if (results.hashMatch === true && results.teamIdMatch === true) {
    return "medium";
  }

  // URL accessible + hash verified, no team ID info → low
  // URL accessible, hash skipped → low
  return "low";
}

function hexFromBuffer(buffer: ArrayBuffer): string {
  return [...new Uint8Array(buffer)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export async function handleArtifactVerify(job: ArtifactVerifyJob, env: Env): Promise<void> {
  const db = createDb(env.DB);
  const now = new Date().toISOString();

  // 1. Load artifact
  const artifact = await db.select().from(artifacts).where(eq(artifacts.id, job.artifactId)).get();
  if (!artifact) {
    throw new Error(`Artifact not found: ${job.artifactId}`);
  }

  // 2. Load release and app context
  const release = await db.select().from(releases).where(eq(releases.id, artifact.releaseId)).get();
  if (!release) {
    throw new Error(`Release not found: ${artifact.releaseId}`);
  }

  const app = await db.select().from(apps).where(eq(apps.id, release.appId)).get();
  if (!app) {
    throw new Error(`App not found: ${release.appId}`);
  }

  // 3. Resolve expected team ID from app aliases if not on artifact
  let expectedTeamId = artifact.expectedTeamId;
  if (!expectedTeamId) {
    const teamAlias = await db
      .select()
      .from(appAliases)
      .where(
        and(
          eq(appAliases.appId, app.id),
          eq(appAliases.aliasType, "team_id"),
          eq(appAliases.isActive, true),
        ),
      )
      .get();
    if (teamAlias) {
      expectedTeamId = teamAlias.value;
    }
  }

  const results: VerificationResults = {
    urlAccessible: null,
    sizeMatch: null,
    hashMatch: null,
    teamIdMatch: null,
  };

  let headStatus: number | null = null;
  let finalUrl: string | null = null;
  let contentLength: number | null = null;
  let contentType: string | null = null;
  let computedHash: string | null = null;
  let downloadedBytes: number | null = null;
  let skipReason: string | null = null;

  // 4. HEAD request
  try {
    const headResponse = await fetch(artifact.url, {
      method: "HEAD",
      headers: { "User-Agent": USER_AGENT },
      signal: AbortSignal.timeout(HEAD_TIMEOUT_MS),
    });
    headStatus = headResponse.status;
    finalUrl = headResponse.url;
    contentType = headResponse.headers.get("content-type");
    const clHeader = headResponse.headers.get("content-length");
    contentLength = clHeader ? parseInt(clHeader, 10) : null;
    results.urlAccessible = headResponse.ok;
  } catch {
    results.urlAccessible = false;
  }

  // 5. Size check
  if (results.urlAccessible && contentLength !== null && artifact.sizeBytes !== null) {
    results.sizeMatch = contentLength === artifact.sizeBytes;
  }

  // 6. Streaming hash verification
  if (results.urlAccessible) {
    const knownSize = contentLength ?? artifact.sizeBytes;
    const tooLarge = knownSize !== null && knownSize > MAX_DOWNLOAD_SIZE;

    if (tooLarge) {
      skipReason = `File too large (${knownSize} bytes)`;
    } else {
      try {
        const response = await fetch(artifact.url, {
          headers: { "User-Agent": USER_AGENT },
          signal: AbortSignal.timeout(DOWNLOAD_TIMEOUT_MS),
        });

        if (!response.ok || !response.body) {
          throw new Error(`Download failed: ${response.status}`);
        }

        // Stream through a counting transform and into DigestStream
        let byteCount = 0;
        const countingTransform = new TransformStream<Uint8Array, Uint8Array>({
          transform(chunk, controller) {
            byteCount += chunk.byteLength;
            if (byteCount > MAX_DOWNLOAD_SIZE) {
              controller.error(new Error("Download exceeded max size"));
              return;
            }
            controller.enqueue(chunk);
          },
        });

        const digestStream = new DigestStream("SHA-256");
        await response.body.pipeThrough(countingTransform).pipeTo(digestStream);

        downloadedBytes = byteCount;
        const hashBuffer = await digestStream.digest;
        computedHash = hexFromBuffer(hashBuffer);

        if (artifact.sha256) {
          results.hashMatch = computedHash === artifact.sha256;
        } else {
          // No stored hash — this establishes the baseline
          results.hashMatch = true;
        }
      } catch {
        // Download failed — leave hashMatch as null (unknown)
        skipReason = skipReason ?? "Download failed";
      }
    }
  }

  // 7. Team ID check
  if (expectedTeamId && artifact.observedTeamId) {
    results.teamIdMatch = expectedTeamId === artifact.observedTeamId;
  }

  // 8. Record observations
  const trustLevel = computeTrustLevel(results);

  // content_hash observation
  await db.insert(artifactObservations).values({
    id: generateId(idPrefixes.artifactObservation),
    artifactId: artifact.id,
    observationType: "content_hash",
    status:
      results.hashMatch === true
        ? "pass"
        : results.hashMatch === false
          ? "fail"
          : computedHash === null && results.urlAccessible !== false
            ? "skipped"
            : "unknown",
    observedValue: computedHash,
    expectedValue: artifact.sha256,
    detailJson: JSON.stringify({
      urlAccessible: results.urlAccessible,
      httpStatus: headStatus,
      finalUrl,
      contentType,
      contentLengthHeader: contentLength,
      storedSizeBytes: artifact.sizeBytes,
      sizeMatch: results.sizeMatch,
      hashMatch: results.hashMatch,
      downloadedBytes,
      skipReason,
    }),
    observedAt: now,
  });

  // team_id observation (if applicable)
  if (expectedTeamId || artifact.observedTeamId) {
    await db.insert(artifactObservations).values({
      id: generateId(idPrefixes.artifactObservation),
      artifactId: artifact.id,
      observationType: "team_id",
      status:
        results.teamIdMatch === true ? "pass" : results.teamIdMatch === false ? "fail" : "skipped",
      observedValue: artifact.observedTeamId,
      expectedValue: expectedTeamId,
      detailJson: null,
      observedAt: now,
    });
  }

  // 9. Update artifact
  const artifactUpdate: Record<string, unknown> = { trustLevel };

  // Backfill sha256 if not stored
  if (!artifact.sha256 && computedHash) {
    artifactUpdate.sha256 = computedHash;
  }

  // Backfill sizeBytes from Content-Length
  if (artifact.sizeBytes === null && contentLength !== null) {
    artifactUpdate.sizeBytes = contentLength;
  }

  // Update expectedTeamId if resolved from alias
  if (!artifact.expectedTeamId && expectedTeamId) {
    artifactUpdate.expectedTeamId = expectedTeamId;
  }

  // Update teamIdMatch
  if (results.teamIdMatch !== null) {
    artifactUpdate.teamIdMatch = results.teamIdMatch ? "match" : "mismatch";
  }

  await db.update(artifacts).set(artifactUpdate).where(eq(artifacts.id, artifact.id));

  // 10. Enqueue recompute-latest
  await env.RECOMPUTE_LATEST_QUEUE.send({ appId: release.appId });
}
