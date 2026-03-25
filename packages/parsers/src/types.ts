export interface ParsedRelease {
  versionRaw: string;
  buildNumber?: string;
  channel: "stable" | "beta" | "nightly";
  isPrerelease: boolean;
  publishedAt?: string;
  releaseNotesUrl?: string;
  downloadUrl?: string;
  artifacts: ParsedArtifact[];
  metadata?: Record<string, unknown>;
}

export interface ParsedArtifact {
  url: string;
  type: "zip" | "dmg" | "pkg" | "appcast_enclosure" | "other";
  sha256?: string;
  sizeBytes?: number;
  architecture?: string;
  minOsVersion?: string;
  signature?: string;
}

export interface ParserOutput {
  releases: ParsedRelease[];
  confidence: number;
  parserVersion: string;
  errors: string[];
}

export interface SourceParser {
  key: string;
  version: string;
  parse(body: string, config?: Record<string, unknown>): ParserOutput;
}
