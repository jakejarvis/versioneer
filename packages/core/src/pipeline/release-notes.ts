import { marked } from "marked";

import { sanitizeHtml } from "./sanitize-html";

const MAX_RELEASE_NOTES_LENGTH = 500_000;

/**
 * Normalize release notes to sanitized HTML.
 * Markdown is converted to HTML first, then all HTML is sanitized.
 */
export function normalizeReleaseNotes(body: string, format: "html" | "markdown"): string {
  let html: string;

  if (format === "markdown") {
    html = marked.parse(body, { async: false }) as string;
  } else {
    html = body;
  }

  html = sanitizeHtml(html);

  if (html.length > MAX_RELEASE_NOTES_LENGTH) {
    // Re-sanitize after truncation so htmlparser2 auto-closes any tags cut mid-way
    html = sanitizeHtml(html.slice(0, MAX_RELEASE_NOTES_LENGTH)) + "<!-- truncated -->";
  }

  return html;
}
