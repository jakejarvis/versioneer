import type { ParsedRelease, ParserOutput, SourceParser } from "./types";

interface ITunesLookupResponse {
  resultCount: number;
  results: ITunesResult[];
}

interface ITunesResult {
  trackId: number;
  bundleId: string;
  trackName: string;
  version: string;
  currentVersionReleaseDate?: string;
  releaseNotes?: string;
  minimumOsVersion?: string;
  fileSizeBytes?: string;
  price?: number;
  formattedPrice?: string;
  artistName?: string;
  sellerUrl?: string;
  trackViewUrl?: string;
  artworkUrl512?: string;
  kind?: string;
}

export const macAppStoreParser: SourceParser = {
  key: "mac_app_store",
  version: "1.0.0",

  parse(body: string, _config?: Record<string, unknown>): ParserOutput {
    const errors: string[] = [];

    try {
      const data = JSON.parse(body) as ITunesLookupResponse;

      if (!data.resultCount || !data.results?.length) {
        errors.push("No results returned from iTunes Lookup API");
        return { releases: [], confidence: 0, parserVersion: this.version, errors };
      }

      // Find the first native Mac app result (filter out iOS-on-Mac)
      const entry = data.results.find((r) => r.kind === "mac-software") ?? data.results[0]!;

      if (!entry.version) {
        errors.push("Result missing version field");
        return { releases: [], confidence: 0, parserVersion: this.version, errors };
      }

      const release: ParsedRelease = {
        versionRaw: entry.version,
        channel: "stable",
        isPrerelease: false,
        publishedAt: entry.currentVersionReleaseDate,
        releaseNotesBody: entry.releaseNotes,
        releaseNotesFormat: "markdown",
        artifacts: entry.trackViewUrl
          ? [
              {
                url: entry.trackViewUrl,
                type: "mac_app_store",
                sizeBytes: entry.fileSizeBytes ? Number(entry.fileSizeBytes) : undefined,
                minOsVersion: entry.minimumOsVersion,
              },
            ]
          : [],
        metadata: {
          trackId: entry.trackId,
          artistName: entry.artistName,
          trackName: entry.trackName,
          bundleId: entry.bundleId,
          price: entry.price,
          formattedPrice: entry.formattedPrice,
          artworkUrl512: entry.artworkUrl512,
          sellerUrl: entry.sellerUrl,
        },
      };

      return {
        releases: [release],
        confidence: 90,
        parserVersion: macAppStoreParser.version,
        errors,
      };
    } catch (e) {
      errors.push(
        `Failed to parse iTunes Lookup JSON: ${e instanceof Error ? e.message : String(e)}`,
      );
      return { releases: [], confidence: 0, parserVersion: macAppStoreParser.version, errors };
    }
  },
};
