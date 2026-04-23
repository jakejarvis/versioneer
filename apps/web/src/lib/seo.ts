export const SITE_URL = "https://versioneer.app";
export const SITE_NAME = "Versioneer";

interface PageSeoOptions {
  title: string;
  description: string;
  path: string;
  robots?: string;
}

export function getPageSeoHead({
  title,
  description,
  path,
  robots = "index, follow",
}: PageSeoOptions) {
  const canonicalUrl = new URL(path, SITE_URL).toString();

  return {
    meta: [
      { title },
      { name: "description", content: description },
      { name: "robots", content: robots },
      { property: "og:title", content: title },
      { property: "og:description", content: description },
      { property: "og:url", content: canonicalUrl },
      { name: "twitter:title", content: title },
      { name: "twitter:description", content: description },
    ],
    links: [{ rel: "canonical", href: canonicalUrl }],
  };
}
