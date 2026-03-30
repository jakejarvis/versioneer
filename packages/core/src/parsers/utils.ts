import type { ParsedArtifact } from "./types";

export function resolveUrl(href: string, baseUrl: string): string {
  if (/^https?:\/\//i.test(href)) return href;
  if (!baseUrl) return href;
  try {
    return new URL(href, baseUrl).toString();
  } catch {
    return href;
  }
}

export function inferArtifactType(url: string): ParsedArtifact["type"] {
  const lower = url.toLowerCase().split("?")[0] ?? "";
  if (lower.endsWith(".dmg")) return "dmg";
  if (lower.endsWith(".zip")) return "zip";
  if (lower.endsWith(".pkg")) return "pkg";
  return "other";
}
