const VOLATILE_QUERY_PARAM_NAMES = new Set([
  "awsaccesskeyid",
  "expires",
  "googleaccessid",
  "response-cache-control",
  "response-content-disposition",
  "response-content-encoding",
  "response-content-language",
  "response-content-type",
  "response-expires",
  "rscc",
  "rscd",
  "rsce",
  "rscl",
  "rsct",
  "se",
  "sig",
  "signature",
  "si",
  "sip",
  "ske",
  "skoid",
  "sks",
  "skt",
  "sktid",
  "skv",
  "sp",
  "spr",
  "sr",
  "srt",
  "ss",
  "st",
  "sv",
]);

export function canonicalizeArtifactUrl(rawUrl: string): string {
  const trimmed = rawUrl.trim();
  if (!trimmed) return trimmed;

  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    return trimmed;
  }

  const filteredEntries = [...url.searchParams.entries()]
    .filter(([name]) => !isVolatileQueryParam(name))
    .sort(([leftName, leftValue], [rightName, rightValue]) => {
      if (leftName === rightName) return leftValue.localeCompare(rightValue);
      return leftName.localeCompare(rightName);
    });

  url.hash = "";
  url.search = "";

  if (
    (url.protocol === "https:" && url.port === "443") ||
    (url.protocol === "http:" && url.port === "80")
  ) {
    url.port = "";
  }

  for (const [name, value] of filteredEntries) {
    url.searchParams.append(name, value);
  }

  return url.toString();
}

export function buildArtifactIdentity(params: { url: string; sha256?: string | null }): {
  canonicalUrl: string;
  identityKey: string;
} {
  const canonicalUrl = canonicalizeArtifactUrl(params.url);
  const normalizedSha256 = normalizeSha256(params.sha256);

  return {
    canonicalUrl,
    identityKey: normalizedSha256 ? `sha256:${normalizedSha256}` : `url:${canonicalUrl}`,
  };
}

export function buildReleaseObservationIdentity(params: {
  observedVersionNormalized?: string | null;
  observedBuildNumber?: string | null;
  observedChannel?: string | null;
  observedPublishedAt?: string | null;
  observedReleaseNotesUrl?: string | null;
  observedDownloadUrl?: string | null;
}): { canonicalObservedDownloadUrl: string | null; observationKey: string } {
  const canonicalObservedDownloadUrl = params.observedDownloadUrl
    ? canonicalizeArtifactUrl(params.observedDownloadUrl)
    : null;

  return {
    canonicalObservedDownloadUrl,
    observationKey: JSON.stringify([
      params.observedVersionNormalized ?? null,
      params.observedBuildNumber ?? null,
      params.observedChannel ?? null,
      params.observedPublishedAt ?? null,
      params.observedReleaseNotesUrl ?? null,
      canonicalObservedDownloadUrl,
    ]),
  };
}

function isVolatileQueryParam(rawName: string): boolean {
  const name = rawName.toLowerCase();
  return (
    name.startsWith("x-amz-") || name.startsWith("x-goog-") || VOLATILE_QUERY_PARAM_NAMES.has(name)
  );
}

function normalizeSha256(rawSha256: string | null | undefined): string | null {
  const normalized = rawSha256?.trim().toLowerCase();
  return normalized ? normalized : null;
}
