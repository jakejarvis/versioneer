import rehypeSanitize from "rehype-sanitize";
import rehypeStringify from "rehype-stringify";
import remarkGfm from "remark-gfm";
import remarkParse from "remark-parse";
import remarkRehype from "remark-rehype";
import { unified } from "unified";

import { sanitizeHtml } from "./sanitize-html";

export const MAX_RELEASE_NOTES_LENGTH = 500_000;
export const TRUNCATED_MARKER = "<!-- truncated -->";

const markdownToHtmlProcessor = unified()
  .use(remarkParse)
  .use(remarkGfm)
  .use(remarkRehype)
  .use(rehypeSanitize)
  .use(rehypeStringify);

export function renderReleaseNotesMarkdownHtml(markdown: string): string {
  return sanitizeAndTruncateHtml(String(markdownToHtmlProcessor.processSync(markdown)));
}

export function renderReleaseNotesHtml(html: string): string {
  return sanitizeAndTruncateHtml(html);
}

function sanitizeAndTruncateHtml(html: string): string {
  let safeHtml = sanitizeHtml(html);

  if (safeHtml.length > MAX_RELEASE_NOTES_LENGTH) {
    // Re-sanitize after truncation so htmlparser2 auto-closes any tags cut mid-way.
    safeHtml = `${sanitizeHtml(safeHtml.slice(0, MAX_RELEASE_NOTES_LENGTH))}${TRUNCATED_MARKER}`;
  }

  return safeHtml;
}
