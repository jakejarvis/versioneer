interface GitHubRelease {
  tag_name: string;
  name: string | null;
  body: string | null;
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
const CACHE_TTL_SECONDS = 300;

export const onRequestGet: PagesFunction<Env> = async (context) => {
  const cache = await caches.open("gh-releases");
  const cacheKey = new Request(context.request.url, { method: "GET" });

  const cached = await cache.match(cacheKey);
  if (cached) return cached;

  const upstream = await fetch(GITHUB_API_URL, {
    headers: {
      Accept: "application/vnd.github.html+json",
      "User-Agent": "versioneer-web",
      ...("GITHUB_TOKEN" in context.env && context.env.GITHUB_TOKEN
        ? { Authorization: `token ${context.env.GITHUB_TOKEN as string}` }
        : {}),
    },
  });

  if (!upstream.ok) {
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
      body_html: r.body ?? null,
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
