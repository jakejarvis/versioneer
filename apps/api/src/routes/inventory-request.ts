import { createMiddleware } from "hono/factory";
import { HTTPException } from "hono/http-exception";

import { installedAppSchema, inventoryRequestEnvelopeSchema } from "@versioneer/core/validation";
import type {
  InstalledApp,
  InvalidInventoryApp,
  InventoryClient,
} from "@versioneer/core/validation";

import {
  MAX_INVENTORY_GZIP_BYTES,
  MAX_INVENTORY_GZIP_EXPANSION_RATIO,
  MAX_INVENTORY_JSON_BYTES,
} from "../lib/constants";

export type InventoryRequestTimings = {
  startedAt: number;
  parseMs: number;
  validationMs: number;
};

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

function elapsedMs(start: number): number {
  return Math.round((performance.now() - start) * 100) / 100;
}

async function readStreamTextLimited(
  stream: ReadableStream<Uint8Array> | null,
  maxBytes: number,
): Promise<{ text: string; byteLength: number }> {
  if (!stream) return { text: "", byteLength: 0 };

  const reader = stream.getReader();
  const decoder = new TextDecoder();
  const chunks: string[] = [];
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
      chunks.push(decoder.decode(value, { stream: true }));
    }
    chunks.push(decoder.decode());
  } finally {
    reader.releaseLock();
  }

  return { text: chunks.join(""), byteLength: bytesRead };
}

function limitStreamBytes(
  stream: ReadableStream<Uint8Array> | null,
  maxBytes: number,
): { stream: ReadableStream<ArrayBuffer | ArrayBufferView> | null; getBytesRead: () => number } {
  let bytesRead = 0;
  if (!stream) return { stream: null, getBytesRead: () => bytesRead };

  return {
    stream: stream.pipeThrough(
      new TransformStream<Uint8Array, ArrayBuffer | ArrayBufferView>({
        transform(chunk, controller) {
          bytesRead += chunk.byteLength;
          if (bytesRead > maxBytes) {
            controller.error(new RequestBodyTooLargeError(maxBytes, bytesRead));
            return;
          }
          controller.enqueue(chunk);
        },
      }),
    ),
    getBytesRead: () => bytesRead,
  };
}

async function readInventoryJson(request: Request): Promise<unknown> {
  const contentEncoding = request.headers.get("content-encoding")?.trim().toLowerCase();
  const contentLength = request.headers.get("content-length") ?? undefined;

  if (!contentEncoding || contentEncoding === "identity") {
    assertContentLengthWithinLimit(contentLength, MAX_INVENTORY_JSON_BYTES);
    const { text } = await readStreamTextLimited(request.body, MAX_INVENTORY_JSON_BYTES);
    return JSON.parse(text) as unknown;
  }

  if (contentEncoding !== "gzip") {
    throw new HTTPException(415, { message: "Unsupported content encoding" });
  }

  assertContentLengthWithinLimit(contentLength, MAX_INVENTORY_GZIP_BYTES);
  const compressed = limitStreamBytes(request.body, MAX_INVENTORY_GZIP_BYTES);
  const decompressedStream =
    compressed.stream?.pipeThrough(new DecompressionStream("gzip")) ?? null;
  const decoded = await readStreamTextLimited(decompressedStream, MAX_INVENTORY_JSON_BYTES);
  const expansionRatio = decoded.byteLength / Math.max(compressed.getBytesRead(), 1);
  if (expansionRatio > MAX_INVENTORY_GZIP_EXPANSION_RATIO) {
    throw new HTTPException(413, { message: "Compressed inventory body expands too much" });
  }
  return JSON.parse(decoded.text) as unknown;
}

export type InventoryEnv = {
  Bindings: Env;
  Variables: {
    inventoryRequest: {
      client: InventoryClient;
      apps: InstalledApp[];
      scanDurationMs?: number;
    };
    invalidInventoryApps: InvalidInventoryApp[];
    inventoryRequestTimings: InventoryRequestTimings;
  };
};

export const gzipJsonMiddleware = createMiddleware<InventoryEnv>(async (c, next) => {
  const timings: InventoryRequestTimings = {
    startedAt: performance.now(),
    parseMs: 0,
    validationMs: 0,
  };
  c.set("inventoryRequestTimings", timings);

  let body: unknown;
  const parseStart = performance.now();
  try {
    body = await readInventoryJson(c.req.raw);
  } catch (error) {
    timings.parseMs = elapsedMs(parseStart);
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
  timings.parseMs = elapsedMs(parseStart);

  const validationStart = performance.now();
  const envelope = inventoryRequestEnvelopeSchema.safeParse(body);
  if (!envelope.success) {
    timings.validationMs = elapsedMs(validationStart);
    throw new HTTPException(400, {
      res: Response.json(
        { error: "Invalid request", details: envelope.error.issues },
        { status: 400 },
      ),
    });
  }

  const validApps: InstalledApp[] = [];
  const invalidInventoryApps: InvalidInventoryApp[] = [];

  for (let index = 0; index < envelope.data.apps.length; index += 1) {
    const raw = envelope.data.apps[index];
    const parsed = installedAppSchema.safeParse(raw);
    if (parsed.success) {
      validApps.push(parsed.data);
      continue;
    }

    const rawObject =
      typeof raw === "object" && raw !== null ? (raw as Record<string, unknown>) : null;
    invalidInventoryApps.push({
      index,
      appName: typeof rawObject?.appName === "string" ? rawObject.appName : null,
      reasons: parsed.error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`),
    });
  }
  timings.validationMs = elapsedMs(validationStart);

  c.set("inventoryRequest", {
    client: envelope.data.client,
    apps: validApps,
    scanDurationMs: envelope.data.scanDurationMs,
  });
  c.set("invalidInventoryApps", invalidInventoryApps);
  await next();
});
