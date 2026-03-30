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

export interface SourceConfigFieldDef {
  key: string;
  label: string;
  placeholder: string;
  required: boolean;
  description?: string;
  short?: boolean;
}

export interface SourceConfigSchema {
  description: string;
  fields: SourceConfigFieldDef[];
}

export const SOURCE_CONFIG_FIELDS: Partial<Record<SourceType, SourceConfigSchema>> = {
  web_page: {
    description: "CSS selectors to extract version and download URLs from HTML.",
    fields: [
      {
        key: "versionSelector",
        label: "Version Selector",
        placeholder: ".version",
        required: true,
        description: "CSS selector for the element containing the version",
      },
      {
        key: "downloadSelector",
        label: "Download Selector",
        placeholder: "a.download",
        required: false,
        description: "CSS selector for download link elements",
      },
      {
        key: "versionPattern",
        label: "Version Pattern",
        placeholder: "([\\d.]+)",
        required: false,
        description: "Optional regex to extract version from the selected text",
      },
    ],
  },
  regex: {
    description: "Regex patterns applied to the raw response body.",
    fields: [
      {
        key: "versionPattern",
        label: "Version Pattern",
        placeholder: "(\\d+\\.\\d+\\.\\d+)",
        required: true,
        description: "Regex with capture group 1 for the version",
      },
      {
        key: "downloadPattern",
        label: "Download Pattern",
        placeholder: "(https://[^\\s]+\\.dmg)",
        required: false,
        description: "Regex with capture group 1 for the download URL",
      },
      {
        key: "flags",
        label: "Flags",
        placeholder: "i",
        required: false,
        description: "Regex flags (e.g. i for case-insensitive)",
        short: true,
      },
    ],
  },
  json: {
    description: "JSONPath expressions to extract values from JSON responses.",
    fields: [
      {
        key: "releasesPath",
        label: "Releases Path",
        placeholder: "$.releases[*]",
        required: false,
        description:
          "JSONPath to array of release objects. Leave empty for single-release feeds.",
      },
      {
        key: "versionPath",
        label: "Version Path",
        placeholder: "$.version",
        required: true,
        description:
          "JSONPath for the version value. Relative to each release when Releases Path is set.",
      },
      {
        key: "downloadPath",
        label: "Download Path",
        placeholder: "$.download_url",
        required: false,
        description:
          "JSONPath for the download URL. Relative to each release when Releases Path is set.",
      },
    ],
  },
  xml: {
    description: "XPath expressions to extract values from XML responses.",
    fields: [
      {
        key: "releasesXPath",
        label: "Releases XPath",
        placeholder: "//release",
        required: false,
        description:
          "XPath to repeating release elements. Leave empty for single-release feeds.",
      },
      {
        key: "versionXPath",
        label: "Version XPath",
        placeholder: "//version/text()",
        required: true,
        description:
          "XPath for the version value. Use ./ prefix for relative paths when Releases XPath is set.",
      },
      {
        key: "downloadXPath",
        label: "Download XPath",
        placeholder: "//download/@url",
        required: false,
        description:
          "XPath for the download URL. Use ./ prefix when Releases XPath is set.",
      },
    ],
  },
};
