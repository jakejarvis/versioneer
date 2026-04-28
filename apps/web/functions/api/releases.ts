interface GitHubRelease {
  tag_name: string;
  name: string | null;
  body_html?: string | null;
  published_at: string | null;
  html_url: string;
  prerelease: boolean;
  draft: boolean;
}

interface Release {
  tag_name: string;
  name: string | null;
  body_html: string | null;
  published_at: string | null;
  html_url: string;
  prerelease: boolean;
}

const GITHUB_API_URL = "https://api.github.com/repos/jakejarvis/versioneer/releases?per_page=50";
const CACHE_NAME = "gh-releases-html-v2";
const CACHE_TTL_SECONDS = 300;

export const onRequestGet: PagesFunction<Env> = async (context) => {
  const cache = await caches.open(CACHE_NAME);
  const cacheUrl = new URL(context.request.url);
  cacheUrl.search = "";
  const cacheKey = new Request(cacheUrl.toString(), { method: "GET" });

  const cached = await cache.match(cacheKey);
  if (cached) return cached;

  let upstream: Response;
  try {
    upstream = await fetch(GITHUB_API_URL, {
      headers: {
        Accept: "application/vnd.github.full+json",
        "User-Agent": "versioneer-web",
        ...("GITHUB_TOKEN" in context.env && context.env.GITHUB_TOKEN
          ? { Authorization: `token ${context.env.GITHUB_TOKEN as string}` }
          : {}),
      },
    });
  } catch (error) {
    context.waitUntil(
      capturePagesEvent(context.env, "marketing_releases_api_failed", {
        status: "failed",
        error_message: error instanceof Error ? error.message : String(error),
      }),
    );
    return new Response(JSON.stringify({ error: "Failed to fetch releases" }), {
      status: 502,
      headers: { "Content-Type": "application/json" },
    });
  }

  if (!upstream.ok) {
    context.waitUntil(
      capturePagesEvent(context.env, "marketing_releases_api_failed", {
        status: "failed",
        upstream_status: upstream.status,
      }),
    );
    return new Response(JSON.stringify({ error: "Failed to fetch releases" }), {
      status: 502,
      headers: { "Content-Type": "application/json" },
    });
  }

  const ghReleases: GitHubRelease[] = await upstream.json();

  const releases: Release[] = ghReleases
    .filter((r) => !r.draft)
    .map((r) => ({
      tag_name: r.tag_name,
      name: r.name,
      body_html: typeof r.body_html === "string" ? r.body_html : null,
      published_at: r.published_at,
      html_url: r.html_url,
      prerelease: r.prerelease,
    }));

  const response = new Response(JSON.stringify(releases), {
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": `public, max-age=${CACHE_TTL_SECONDS}`,
    },
  });

  context.waitUntil(cache.put(cacheKey, response.clone()));

  return response;
};

async function capturePagesEvent(
  env: Env,
  event: string,
  properties: Record<string, unknown>,
): Promise<void> {
  const token = "POSTHOG_PROJECT_TOKEN" in env ? env.POSTHOG_PROJECT_TOKEN : undefined;
  if (!token) return;

  const host =
    "POSTHOG_HOST" in env && typeof env.POSTHOG_HOST === "string"
      ? env.POSTHOG_HOST
      : "https://us.i.posthog.com";
  const environment =
    "ENVIRONMENT" in env && typeof env.ENVIRONMENT === "string" ? env.ENVIRONMENT : "production";

  try {
    await fetch(`${host}/capture/`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        api_key: token,
        distinct_id: "versioneer-web-api",
        event,
        properties: {
          surface: "web",
          environment,
          ...properties,
        },
      }),
    });
  } catch {
    // Observability must never affect the release API response path.
  }
}
