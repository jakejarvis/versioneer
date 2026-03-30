import type { SourceType } from "@versioneer/schemas/sources";

interface SourceTypeUIConfig {
  label: string;
  color: string;
  input: { label: string; placeholder: string };
}

export const SOURCE_TYPES = {
  sparkle: {
    label: "Sparkle",
    color: "border-orange-500/30 bg-orange-500/10 text-orange-400",
    input: { label: "Feed URL", placeholder: "https://example.com/appcast.xml" },
  },
  github_releases: {
    label: "GitHub Releases",
    color: "border-neutral-500/30 bg-neutral-500/10 text-neutral-300",
    input: { label: "Repository", placeholder: "owner/repo" },
  },
  homebrew_cask: {
    label: "Homebrew Cask",
    color: "border-emerald-500/30 bg-emerald-500/10 text-emerald-400",
    input: { label: "Cask Token", placeholder: "firefox" },
  },
  mac_app_store: {
    label: "Mac App Store",
    color: "border-blue-500/30 bg-blue-500/10 text-blue-400",
    input: { label: "Bundle ID", placeholder: "com.example.app" },
  },
  electron_generic: {
    label: "Electron Feed",
    color: "border-violet-500/30 bg-violet-500/10 text-violet-400",
    input: { label: "Feed URL", placeholder: "https://example.com/update/RELEASES" },
  },
  rss_feed: {
    label: "RSS Feed",
    color: "border-amber-500/30 bg-amber-500/10 text-amber-400",
    input: { label: "Feed URL", placeholder: "https://example.com/feed.xml" },
  },
  json_feed: {
    label: "JSON Feed",
    color: "border-rose-500/30 bg-rose-500/10 text-rose-400",
    input: { label: "Feed URL", placeholder: "https://example.com/feed.json" },
  },
  web_page: {
    label: "Web Page",
    color: "border-teal-500/30 bg-teal-500/10 text-teal-400",
    input: { label: "Page URL", placeholder: "https://example.com/downloads" },
  },
  regex: {
    label: "Regex",
    color: "border-pink-500/30 bg-pink-500/10 text-pink-400",
    input: { label: "Page URL", placeholder: "https://example.com/update-feed.plist" },
  },
  json: {
    label: "JSON",
    color: "border-sky-500/30 bg-sky-500/10 text-sky-400",
    input: { label: "JSON URL", placeholder: "https://example.com/api/version.json" },
  },
  xml: {
    label: "XML",
    color: "border-indigo-500/30 bg-indigo-500/10 text-indigo-400",
    input: { label: "XML URL", placeholder: "https://example.com/update-feed.xml" },
  },
  manual: {
    label: "Manual",
    color: "border-cyan-500/30 bg-cyan-500/10 text-cyan-400",
    input: { label: "", placeholder: "" },
  },
} as const satisfies Record<SourceType, SourceTypeUIConfig>;

export function defaultLabelForSourceType(sourceType: SourceType) {
  return SOURCE_TYPES[sourceType].label;
}
