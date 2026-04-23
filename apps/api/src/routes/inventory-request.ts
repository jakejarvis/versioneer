import { createMiddleware } from "hono/factory";
import { HTTPException } from "hono/http-exception";

import { installedAppSchema, inventoryRequestEnvelopeSchema } from "@versioneer/core/validation";
import type { InstalledApp, InventoryClient, SkippedApp } from "@versioneer/core/validation";

import {
  MAX_INVENTORY_GZIP_BYTES,
  MAX_INVENTORY_GZIP_EXPANSION_RATIO,
  MAX_INVENTORY_JSON_BYTES,
} from "../lib/constants";

class RequestBodyTooLargeError extends Error {
  constructor(
    readonly maxBytes: number,
    readonly actualBytes: number,
  ) {
    super(`Request body exceeds ${maxBytes} bytes`);
  }
}

function parseContentLength(value: string | undefined): number | null {
  if (!value) return null;
  const parsed = Number.parseInt(value, 10);
  return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : null;
}

function assertContentLengthWithinLimit(value: string | undefined, maxBytes: number) {
  const contentLength = parseContentLength(value);
  if (contentLength !== null && contentLength > maxBytes) {
    throw new RequestBodyTooLargeError(maxBytes, contentLength);
  }
}

async function readStreamBytesLimited(
  stream: ReadableStream<Uint8Array> | null,
  maxBytes: number,
): Promise<Uint8Array> {
  if (!stream) return new Uint8Array();

  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  let bytesRead = 0;

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      bytesRead += value.byteLength;
      if (bytesRead > maxBytes) {
        await reader.cancel();
        throw new RequestBodyTooLargeError(maxBytes, bytesRead);
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }

  const bytes = new Uint8Array(bytesRead);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}

function isGzipBody(bytes: Uint8Array): boolean {
  return bytes.length >= 2 && bytes[0] === 0x1f && bytes[1] === 0x8b;
}

function copyToArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  return copy.buffer;
}

async function readInventoryJson(request: Request): Promise<unknown> {
  const contentEncoding = request.headers.get("content-encoding")?.trim().toLowerCase();
  const contentLength = request.headers.get("content-length") ?? undefined;
  const decoder = new TextDecoder();

  if (!contentEncoding || contentEncoding === "identity") {
    assertContentLengthWithinLimit(contentLength, MAX_INVENTORY_JSON_BYTES);
    const bytes = await readStreamBytesLimited(request.body, MAX_INVENTORY_JSON_BYTES);
    return JSON.parse(decoder.decode(bytes)) as unknown;
  }

  if (contentEncoding !== "gzip") {
    throw new HTTPException(415, { message: "Unsupported content encoding" });
  }

  assertContentLengthWithinLimit(contentLength, MAX_INVENTORY_GZIP_BYTES);
  const compressed = await readStreamBytesLimited(request.body, MAX_INVENTORY_GZIP_BYTES);
  if (!isGzipBody(compressed)) {
    throw new Error("Invalid gzip body");
  }
  const decompressedStream = new Blob([copyToArrayBuffer(compressed)])
    .stream()
    .pipeThrough(new DecompressionStream("gzip"));
  const decoded = await readStreamBytesLimited(decompressedStream, MAX_INVENTORY_JSON_BYTES);
  const expansionRatio = decoded.byteLength / Math.max(compressed.byteLength, 1);
  if (expansionRatio > MAX_INVENTORY_GZIP_EXPANSION_RATIO) {
    throw new HTTPException(413, { message: "Compressed inventory body expands too much" });
  }
  return JSON.parse(decoder.decode(decoded)) as unknown;
}

export type InventoryEnv = {
  Bindings: Env;
  Variables: {
    inventoryRequest: {
      client: InventoryClient;
      apps: InstalledApp[];
      scanDurationMs?: number;
    };
    skippedApps: SkippedApp[];
  };
};

export const gzipJsonMiddleware = createMiddleware<InventoryEnv>(async (c, next) => {
  let body: unknown;
  try {
    body = await readInventoryJson(c.req.raw);
  } catch (error) {
    if (error instanceof HTTPException) {
      throw error;
    }
    if (error instanceof RequestBodyTooLargeError) {
      throw new HTTPException(413, {
        res: Response.json(
          {
            error: "Request body too large",
            maxBytes: error.maxBytes,
            actualBytes: error.actualBytes,
          },
          { status: 413 },
        ),
      });
    }
    throw new HTTPException(400, { message: "Invalid JSON body" });
  }

  const envelope = inventoryRequestEnvelopeSchema.safeParse(body);
  if (!envelope.success) {
    throw new HTTPException(400, {
      res: Response.json(
        { error: "Invalid request", details: envelope.error.issues },
        { status: 400 },
      ),
    });
  }

  const validApps: InstalledApp[] = [];
  const skippedApps: SkippedApp[] = [];

  for (let index = 0; index < envelope.data.apps.length; index += 1) {
    const raw = envelope.data.apps[index];
    const parsed = installedAppSchema.safeParse(raw);
    if (parsed.success) {
      validApps.push(parsed.data);
      continue;
    }

    const rawObject =
      typeof raw === "object" && raw !== null ? (raw as Record<string, unknown>) : null;
    skippedApps.push({
      index,
      appName: typeof rawObject?.appName === "string" ? rawObject.appName : null,
      reasons: parsed.error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`),
    });
  }

  c.set("inventoryRequest", {
    client: envelope.data.client,
    apps: validApps,
    scanDurationMs: envelope.data.scanDurationMs,
  });
  c.set("skippedApps", skippedApps);
  await next();
});
