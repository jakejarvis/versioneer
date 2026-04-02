import type { SourceTypeDescriptor } from "./types";

export const defaultDescriptor: SourceTypeDescriptor = {
  resolveUrl: (identifier) => identifier || null,
  extractIdentifier: (baseUrl) => baseUrl,
  skipsFetch: false,
  buildFetchUrls: (baseUrl) => [baseUrl],
  fetchHeaders: () => ({}),
  resolveArtifactBase: (baseUrl) => baseUrl,
  derivedAlias: () => null,
};
