interface SourceTypeConfig {
  label: string;
  color: string;
  pollInterval: number;
  input: { label: string; placeholder: string };
  parserKey: string;
  /** Whether the validate-source endpoint can test this type */
  validatable: boolean;
  defaultRole: "authority" | "corroborating" | "reference";
  defaultRuntimeStatus: "active" | "disabled";
}

export const SOURCE_TYPES = {
  sparkle: {
    label: "Sparkle",
    color: "border-orange-500/30 bg-orange-500/10 text-orange-400",
    pollInterval: 60,
    input: { label: "Feed URL", placeholder: "https://example.com/appcast.xml" },
    parserKey: "sparkle",
    validatable: true,
    defaultRole: "authority",
    defaultRuntimeStatus: "active",
  },
  github_releases: {
    label: "GitHub Releases",
    color: "border-neutral-500/30 bg-neutral-500/10 text-neutral-300",
    pollInterval: 60,
    input: { label: "Repository", placeholder: "owner/repo" },
    parserKey: "github-releases",
    validatable: true,
    defaultRole: "authority",
    defaultRuntimeStatus: "active",
  },
  homebrew_cask: {
    label: "Homebrew Cask",
    color: "border-emerald-500/30 bg-emerald-500/10 text-emerald-400",
    pollInterval: 360,
    input: { label: "Cask Token", placeholder: "firefox" },
    parserKey: "homebrew-cask",
    validatable: true,
    defaultRole: "corroborating",
    defaultRuntimeStatus: "active",
  },
  mac_app_store: {
    label: "Mac App Store",
    color: "border-blue-500/30 bg-blue-500/10 text-blue-400",
    pollInterval: 1440,
    input: { label: "Bundle ID", placeholder: "com.example.app" },
    parserKey: "mac-app-store",
    validatable: true,
    defaultRole: "authority",
    defaultRuntimeStatus: "active",
  },
  electron_generic: {
    label: "Electron Feed",
    color: "border-violet-500/30 bg-violet-500/10 text-violet-400",
    pollInterval: 60,
    input: { label: "Feed URL", placeholder: "https://example.com/update/RELEASES" },
    parserKey: "electron-generic",
    validatable: true,
    defaultRole: "authority",
    defaultRuntimeStatus: "active",
  },
  rss_feed: {
    label: "RSS Feed",
    color: "border-amber-500/30 bg-amber-500/10 text-amber-400",
    pollInterval: 360,
    input: { label: "Feed URL", placeholder: "https://example.com/feed.xml" },
    parserKey: "rss-reference",
    validatable: false,
    defaultRole: "reference",
    defaultRuntimeStatus: "disabled",
  },
  json_feed: {
    label: "JSON Feed",
    color: "border-rose-500/30 bg-rose-500/10 text-rose-400",
    pollInterval: 360,
    input: { label: "Feed URL", placeholder: "https://example.com/feed.json" },
    parserKey: "json-reference",
    validatable: false,
    defaultRole: "reference",
    defaultRuntimeStatus: "disabled",
  },
  manual: {
    label: "Manual",
    color: "border-cyan-500/30 bg-cyan-500/10 text-cyan-400",
    pollInterval: 1440,
    input: { label: "", placeholder: "" },
    parserKey: "manual",
    validatable: false,
    defaultRole: "authority",
    defaultRuntimeStatus: "active",
  },
} as const satisfies Record<string, SourceTypeConfig>;

export type SourceType = keyof typeof SOURCE_TYPES;

export const SOURCE_TYPE_KEYS = Object.keys(SOURCE_TYPES) as SourceType[];

export function defaultRoleForSourceType(sourceType: SourceType) {
  return SOURCE_TYPES[sourceType].defaultRole;
}

export function defaultParserKeyForSourceType(sourceType: SourceType) {
  return SOURCE_TYPES[sourceType].parserKey;
}

export function defaultLabelForSourceType(sourceType: SourceType) {
  return SOURCE_TYPES[sourceType].label;
}

export function defaultRuntimeStatusForSourceType(sourceType: SourceType) {
  return SOURCE_TYPES[sourceType].defaultRuntimeStatus;
}
