import { createServerFn } from "@tanstack/react-start";

const GITHUB_RELEASES_URL =
  "https://api.github.com/repos/jakejarvis/versioneer/releases?per_page=50";
const DOWNLOADS_HOST = "https://dl.versioneer.app";
const FETCH_TIMEOUT_MS = 10_000;
const MAX_RELEASE_TEXT_LENGTH = 200_000;
const RELEASE_TAG_PATTERN = /^[A-Za-z0-9._-]{1,128}$/;
const GITHUB_RELEASE_URL_PREFIX = "https://github.com/jakejarvis/versioneer/releases/tag/";

interface ReleaseDownloads {
  dmgUrl: string;
  zipUrl: string;
}

export interface Release {
  tag_name: string;
  body_html: string | null;
  published_at: string | null;
  html_url: string;
  downloads: ReleaseDownloads | null;
  prerelease: boolean;
}

export const getMarketingReleases = createServerFn({ method: "GET" }).handler(
  async (): Promise<Release[]> => {
    return fetchReleases();
  },
);

async function fetchReleases(): Promise<Release[]> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

  try {
    const response = await fetch(GITHUB_RELEASES_URL, {
      headers: githubHeaders(),
      signal: controller.signal,
    });

    if (!response.ok) {
      throw new Error(`GitHub releases request failed with ${response.status}`);
    }

    return parseReleases(await response.json());
  } finally {
    clearTimeout(timeout);
  }
}

function githubHeaders(): Headers {
  const headers = new Headers({
    Accept: "application/vnd.github.full+json",
    "User-Agent": "versioneer-web",
  });

  if (process.env.GITHUB_TOKEN) {
    headers.set("Authorization", `Bearer ${process.env.GITHUB_TOKEN}`);
  }

  return headers;
}

function parseReleases(payload: unknown): Release[] {
  if (!Array.isArray(payload)) {
    throw new Error("GitHub releases response was not an array");
  }

  return payload.flatMap((item) => {
    const release = parseRelease(item);
    return release ? [release] : [];
  });
}

function parseRelease(item: unknown): Release | null {
  if (!isRecord(item)) return null;
  if (item.draft !== false) return null;
  if (typeof item.prerelease !== "boolean") return null;
  if (!isReleaseTag(item.tag_name)) return null;
  if (!isReleaseUrl(item.html_url)) return null;

  return {
    tag_name: item.tag_name,
    body_html: optionalText(item.body_html, MAX_RELEASE_TEXT_LENGTH),
    published_at: optionalDate(item.published_at),
    html_url: item.html_url,
    downloads: releaseDownloads(item.tag_name, item.prerelease),
    prerelease: item.prerelease,
  };
}

function releaseDownloads(tag: string, prerelease: boolean): ReleaseDownloads | null {
  if (tag.startsWith("nightly-")) {
    return downloads(`nightly/downloads/Versioneer-${tag}`);
  }

  if (!prerelease && tag.startsWith("v")) {
    return downloads(`downloads/Versioneer-${tag.slice(1)}`);
  }

  return null;
}

function downloads(path: string): ReleaseDownloads {
  return {
    dmgUrl: `${DOWNLOADS_HOST}/${path}.dmg`,
    zipUrl: `${DOWNLOADS_HOST}/${path}.zip`,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isReleaseTag(value: unknown): value is string {
  return typeof value === "string" && RELEASE_TAG_PATTERN.test(value);
}

function isReleaseUrl(value: unknown): value is string {
  return typeof value === "string" && value.startsWith(GITHUB_RELEASE_URL_PREFIX);
}

function optionalText(value: unknown, maxLength: number): string | null {
  if (typeof value !== "string") return null;
  if (value.length === 0 || value.length > maxLength) return null;
  return value;
}

function optionalDate(value: unknown): string | null {
  if (typeof value !== "string") return null;
  return Number.isNaN(Date.parse(value)) ? null : value;
}
