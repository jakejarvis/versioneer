import type { ArtifactArchitecture } from "@versioneer/schemas/architecture";
import type { ArtifactType } from "@versioneer/schemas/releases";

export interface ParsedRelease {
  versionRaw: string;
  buildNumber?: string;
  channel: string;
  isPrerelease: boolean;
  publishedAt?: string;
  releaseNotesUrl?: string;
  releaseNotesBody?: string;
  releaseNotesFormat?: "html" | "markdown" | "text";
  downloadUrl?: string;
  artifacts: ParsedArtifact[];
  metadata?: Record<string, unknown>;
}

export interface ParsedArtifact {
  url: string;
  type: ArtifactType;
  sha256?: string;
  sizeBytes?: number;
  architecture?: ArtifactArchitecture;
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
