import { marked } from "marked";

import { sanitizeHtml } from "./sanitize-html";

const MAX_RELEASE_NOTES_LENGTH = 500_000;
const EMPTY_RELEASE_NOTES_MESSAGE = "Release notes were not provided for this release.";

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

/**
 * Render standalone release-notes HTML for publishing to Sparkle.
 * The body is normalized and sanitized first, then wrapped in a minimal document shell.
 */
export function renderReleaseNotesDocument(
  body: string,
  format: "html" | "markdown",
  title: string,
): string {
  const normalizedBody = normalizeReleaseNotes(
    body.trim().length > 0 ? body : EMPTY_RELEASE_NOTES_MESSAGE,
    format,
  );

  return [
    "<!doctype html>",
    '<html lang="en">',
    "<head>",
    '  <meta charset="utf-8">',
    '  <meta name="viewport" content="width=device-width, initial-scale=1">',
    `  <title>${escapeHtml(title)}</title>`,
    "  <style>",
    "    :root { color-scheme: light dark; }",
    "    body {",
    "      margin: 0;",
    "      background: #0f172a;",
    "      color: #e2e8f0;",
    '      font: 16px/1.65 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;',
    "    }",
    "    main {",
    "      max-width: 760px;",
    "      margin: 0 auto;",
    "      padding: 48px 24px 64px;",
    "    }",
    "    h1, h2, h3, h4, h5, h6 { color: #f8fafc; line-height: 1.2; }",
    "    a { color: #7dd3fc; }",
    "    code, pre {",
    "      font: 13px/1.5 ui-monospace, SFMono-Regular, Menlo, monospace;",
    "      background: rgba(15, 23, 42, 0.45);",
    "      border-radius: 10px;",
    "    }",
    "    code { padding: 0.15em 0.35em; }",
    "    pre { overflow-x: auto; padding: 14px 16px; }",
    "    blockquote {",
    "      margin: 0;",
    "      padding-left: 16px;",
    "      border-left: 3px solid rgba(125, 211, 252, 0.45);",
    "      color: #cbd5e1;",
    "    }",
    "    img { max-width: 100%; height: auto; }",
    "    table { width: 100%; border-collapse: collapse; }",
    "    th, td { padding: 8px 10px; border: 1px solid rgba(148, 163, 184, 0.25); }",
    "    hr { border: 0; border-top: 1px solid rgba(148, 163, 184, 0.2); }",
    "  </style>",
    "</head>",
    "<body>",
    "  <main>",
    `    <h1>${escapeHtml(title)}</h1>`,
    normalizedBody
      .split("\n")
      .map((line) => `    ${line}`)
      .join("\n"),
    "  </main>",
    "</body>",
    "</html>",
  ].join("\n");
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}
