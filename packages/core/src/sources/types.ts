import type { AliasType } from "@versioneer/schemas/catalog";

export interface FetchTokens {
  githubToken?: string;
}

export interface SourceTypeDescriptor {
  /** Convert identifier → stored baseUrl. Input is pre-trimmed and non-empty. */
  resolveUrl(identifier: string): string | null;
  /** Stored baseUrl → user-facing identifier (inverse of resolveUrl) */
  extractIdentifier(baseUrl: string): string;
  /** Whether this source type skips HTTP fetching entirely */
  skipsFetch: boolean;
  /** Ordered list of URLs to try fetching */
  buildFetchUrls(baseUrl: string): string[];
  /** Extra HTTP headers for fetch requests */
  fetchHeaders(tokens: FetchTokens): Record<string, string>;
  /** Base URL for resolving relative artifact paths in parsed output */
  resolveArtifactBase(baseUrl: string): string;
  /** Derived alias from this source's URL, or null if type has no derived alias */
  derivedAlias(baseUrl: string): { aliasType: AliasType; value: string } | null;
}
