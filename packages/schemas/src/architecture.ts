import { z } from "zod";

export const targetArchitectureValues = ["arm64", "x86_64"] as const;
export const targetArchitectureSchema = z.enum(targetArchitectureValues);
export type TargetArchitecture = z.infer<typeof targetArchitectureSchema>;

export const artifactArchitectureValues = ["arm64", "x86_64", "universal", "unknown"] as const;
export const artifactArchitectureSchema = z.enum(artifactArchitectureValues);
export type ArtifactArchitecture = z.infer<typeof artifactArchitectureSchema>;

const ARM64_TOKENS = new Set(["arm64", "aarch64", "apple-silicon", "apple_silicon", "silicon"]);
const X86_TOKENS = new Set(["x86_64", "x64", "amd64", "intel", "x86-64"]);
const UNIVERSAL_TOKENS = new Set(["universal", "universal2", "fat"]);

function normalizedToken(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, "-");
}

export function normalizeArtifactArchitecture(value: unknown): ArtifactArchitecture {
  if (typeof value !== "string") return "unknown";
  const token = normalizedToken(value);
  if (!token) return "unknown";
  if (ARM64_TOKENS.has(token)) return "arm64";
  if (X86_TOKENS.has(token)) return "x86_64";
  if (UNIVERSAL_TOKENS.has(token)) return "universal";
  return "unknown";
}

export function normalizeTargetArchitecture(value: unknown): TargetArchitecture | null {
  const normalized = normalizeArtifactArchitecture(value);
  return normalized === "arm64" || normalized === "x86_64" ? normalized : null;
}

export function architectureFromText(value: string | null | undefined): ArtifactArchitecture {
  if (!value) return "unknown";
  const token = normalizedToken(value);
  if (token.includes("universal")) return "universal";
  if (
    token.includes("arm64") ||
    token.includes("aarch64") ||
    token.includes("apple-silicon") ||
    token.includes("apple_silicon")
  ) {
    return "arm64";
  }
  if (
    token.includes("x86_64") ||
    token.includes("x86-64") ||
    token.includes("amd64") ||
    token.includes("x64") ||
    token.includes("intel")
  ) {
    return "x86_64";
  }
  return "unknown";
}

export function artifactSupportsTarget(
  artifactArchitecture: string | null | undefined,
  targetArchitecture: TargetArchitecture,
): boolean {
  const architecture = normalizeArtifactArchitecture(artifactArchitecture);
  if (architecture === "universal" || architecture === "unknown") return true;
  if (architecture === targetArchitecture) return true;
  return targetArchitecture === "arm64" && architecture === "x86_64";
}

export function rankArtifactForTarget(
  artifactArchitecture: string | null | undefined,
  targetArchitecture: TargetArchitecture,
): number {
  const architecture = normalizeArtifactArchitecture(artifactArchitecture);
  if (architecture === targetArchitecture) return 400;
  if (architecture === "universal") return 300;
  if (targetArchitecture === "arm64" && architecture === "x86_64") return 200;
  if (architecture === "unknown") return 100;
  return -1;
}
