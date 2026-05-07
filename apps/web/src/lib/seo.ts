export const SITE_URL = "https://versioneer.app";
export const SITE_NAME = "Versioneer";
export const SITE_TAGLINE = "Free & open-source macOS app updater";
export const SITE_DESCRIPTION =
  "Versioneer is a modern macOS app updater focused on broad compatibility, privacy-friendly crowdsourcing, and safe one-click installs.";

interface PageSeoOptions {
  title?: string;
  description?: string;
  path: string;
}

export function getPageSeoHead({ title, description, path }: PageSeoOptions) {
  const canonicalUrl = new URL(path, SITE_URL).toString();

  return {
    meta: [
      { title: title ? `${title} — ${SITE_NAME}` : `${SITE_NAME} — ${SITE_TAGLINE}` },
      { name: "description", content: description ?? SITE_DESCRIPTION },
      { property: "og:title", content: title ?? `${SITE_NAME} — ${SITE_TAGLINE}` },
      { property: "og:site_name", content: SITE_NAME },
      { property: "og:type", content: "website" },
      { property: "og:description", content: description ?? SITE_DESCRIPTION },
      { property: "og:url", content: canonicalUrl },
      { name: "twitter:title", content: title ?? `${SITE_NAME} — ${SITE_TAGLINE}` },
      { name: "twitter:description", content: description ?? SITE_DESCRIPTION },
    ],
    links: [{ rel: "canonical", href: canonicalUrl }],
  };
}
