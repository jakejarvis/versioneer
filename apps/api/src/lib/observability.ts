import type { Context } from "hono";

import {
  captureServerEvent,
  captureServerException,
  type ObservabilityProperties,
} from "@versioneer/core/observability";

function jwtSubject(payload: unknown): string | null {
  if (!payload || typeof payload !== "object") return null;
  const subject = (payload as { sub?: unknown }).sub;
  return typeof subject === "string" && subject.length > 0 ? subject : null;
}

type ApiObservabilityContext = {
  env: Env;
  req: Context<{ Bindings: Env }>["req"];
  executionCtx: Context<{ Bindings: Env }>["executionCtx"];
  get(key: string): unknown;
};

function apiDistinctId(c: ApiObservabilityContext): string {
  return jwtSubject(c.get("jwtPayload")) ?? c.req.header("cf-ray") ?? "anonymous-api-client";
}

function baseApiProperties(c: ApiObservabilityContext): ObservabilityProperties {
  return {
    surface: "api",
    request_id: c.req.header("cf-ray") ?? null,
    method: c.req.method,
    path: c.req.path,
  };
}

export function captureApiEvent(
  c: ApiObservabilityContext,
  event: string,
  properties: ObservabilityProperties = {},
) {
  const promise = captureServerEvent(c.env, {
    distinctId: apiDistinctId(c),
    event,
    properties: {
      ...baseApiProperties(c),
      ...properties,
    },
  });
  waitUntil(c, promise);
}

export function captureApiException(
  c: ApiObservabilityContext,
  error: unknown,
  properties: ObservabilityProperties = {},
) {
  const promise = captureServerException(c.env, {
    distinctId: apiDistinctId(c),
    error,
    properties: {
      ...baseApiProperties(c),
      ...properties,
    },
  });
  waitUntil(c, promise);
}

function waitUntil(c: ApiObservabilityContext, promise: Promise<unknown>) {
  try {
    c.executionCtx.waitUntil(promise);
  } catch {
    void promise;
  }
}
