import { PostHog } from "posthog-node/edge";

const DEFAULT_POSTHOG_HOST = "https://us.i.posthog.com";
const SYSTEM_DISTINCT_ID = "versioneer-system";
const MAX_PROPERTY_STRING_LENGTH = 500;
const SENSITIVE_PROPERTY_PATTERN =
  /authorization|cookie|password|secret|token|jwt|signature|attestation|credential|private|body|payload/i;
const SENSITIVE_TEXT_PATTERNS: Array<[RegExp, string]> = [
  [
    /\b(authorization|cookie|password|secret|token|api[_-]?key)=(?:Bearer\s+)?([^&\s]+)/gi,
    "$1=[redacted]",
  ],
  [
    /"(authorization|cookie|password|secret|token|api[_-]?key)"\s*:\s*"[^"]*"/gi,
    '"$1":"[redacted]"',
  ],
  [/\bBearer\s+[A-Za-z0-9._~+/=-]+/gi, "Bearer [redacted]"],
  [/\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/g, "[redacted-jwt]"],
  [/\b(?:phc|ghp|github_pat|sk)-[A-Za-z0-9_=-]{8,}\b/gi, "[redacted-token]"],
];

export interface PostHogRuntimeEnv {
  POSTHOG_PROJECT_TOKEN?: string;
  POSTHOG_HOST?: string;
  ENVIRONMENT?: string;
}

export type ObservabilityProperties = Record<string, unknown>;

export interface CaptureServerEventInput {
  event: string;
  distinctId?: string | null;
  properties?: ObservabilityProperties;
}

export interface CaptureServerExceptionInput {
  error: unknown;
  distinctId?: string | null;
  properties?: ObservabilityProperties;
}

let cachedClientKey: string | null = null;
let cachedClient: PostHog | null = null;

export function getPostHogHost(env: PostHogRuntimeEnv): string {
  const host = env.POSTHOG_HOST?.trim();
  return host && host.length > 0 ? host : DEFAULT_POSTHOG_HOST;
}

export function getServerPostHog(env: PostHogRuntimeEnv): PostHog | null {
  const token = env.POSTHOG_PROJECT_TOKEN?.trim();
  if (!token) return null;

  const host = getPostHogHost(env);
  const clientKey = `${host}:${token}`;
  if (cachedClient && cachedClientKey === clientKey) return cachedClient;

  cachedClient = new PostHog(token, {
    host,
    flushAt: 1,
    flushInterval: 0,
    disableGeoip: true,
    disableCompression: true,
    disableRemoteConfig: true,
  });
  cachedClientKey = clientKey;
  return cachedClient;
}

export function safeFailureMetadata(error: unknown): ObservabilityProperties {
  if (error instanceof Error) {
    return {
      error_name: error.name,
      error_message: redactSensitiveText(error.message),
    };
  }

  if (error === undefined) {
    return { error_message: "Unknown error" };
  }

  return {
    error_message: redactSensitiveText(String(error)),
  };
}

export function sanitizeAnalyticsProperties(
  properties: ObservabilityProperties = {},
): ObservabilityProperties {
  const sanitized: ObservabilityProperties = {};

  for (const [key, value] of Object.entries(properties)) {
    if (SENSITIVE_PROPERTY_PATTERN.test(key)) continue;
    const safeValue = toPostHogProperty(value);
    if (safeValue !== undefined) sanitized[key] = safeValue;
  }

  return sanitized;
}

export async function captureServerEvent(
  env: PostHogRuntimeEnv,
  input: CaptureServerEventInput,
): Promise<boolean> {
  const client = getServerPostHog(env);
  if (!client) return false;

  try {
    await client.captureImmediate({
      distinctId: normalizeDistinctId(input.distinctId),
      event: input.event,
      properties: withBaseProperties(env, input.properties),
    });
    return true;
  } catch (error) {
    console.warn("PostHog event capture failed", safeFailureMetadata(error));
    return false;
  }
}

export async function captureServerException(
  env: PostHogRuntimeEnv,
  input: CaptureServerExceptionInput,
): Promise<boolean> {
  const client = getServerPostHog(env);
  if (!client) return false;

  try {
    await client.captureExceptionImmediate(
      input.error,
      normalizeDistinctId(input.distinctId),
      withBaseProperties(env, {
        ...input.properties,
        ...safeFailureMetadata(input.error),
      }),
    );
    return true;
  } catch (error) {
    console.warn("PostHog exception capture failed", safeFailureMetadata(error));
    return false;
  }
}

function withBaseProperties(
  env: PostHogRuntimeEnv,
  properties: ObservabilityProperties = {},
): ObservabilityProperties {
  return {
    environment: env.ENVIRONMENT ?? "dev",
    ...sanitizeAnalyticsProperties(properties),
  };
}

function normalizeDistinctId(distinctId: string | null | undefined): string {
  const normalized = distinctId?.trim();
  return normalized && normalized.length > 0 ? normalized : SYSTEM_DISTINCT_ID;
}

function redactSensitiveText(value: string): string {
  const truncated =
    value.length > MAX_PROPERTY_STRING_LENGTH
      ? `${value.slice(0, MAX_PROPERTY_STRING_LENGTH)}...`
      : value;
  return SENSITIVE_TEXT_PATTERNS.reduce(
    (message, [pattern, replacement]) => message.replace(pattern, replacement),
    truncated,
  );
}

function toPostHogProperty(value: unknown): unknown {
  if (value === null) return null;

  switch (typeof value) {
    case "string":
      return redactSensitiveText(value);
    case "number":
    case "boolean":
      return value;
    case "bigint":
      return value.toString();
    case "undefined":
    case "function":
    case "symbol":
      return undefined;
    case "object":
      if (value instanceof Date) return value.toISOString();
      if (Array.isArray(value)) {
        return value
          .map((entry) => toPostHogProperty(entry))
          .filter((entry) => entry !== undefined);
      }
      return sanitizeAnalyticsProperties(value as ObservabilityProperties);
  }
  return undefined;
}
