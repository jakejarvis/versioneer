import rehypeParse from "rehype-parse";
import rehypeRemark from "rehype-remark";
import rehypeSanitize, { defaultSchema } from "rehype-sanitize";
import type { Options as RehypeSanitizeOptions } from "rehype-sanitize";
import remarkGfm from "remark-gfm";
import remarkStringify from "remark-stringify";
import { unified } from "unified";

import { MAX_RELEASE_NOTES_LENGTH, TRUNCATED_MARKER } from "./release-notes-render";
import { sanitizeHtml } from "./sanitize-html";

export type ReleaseNotesFormat = "html" | "markdown" | "text";

const releaseNotesSanitizeSchema: RehypeSanitizeOptions = {
  ...defaultSchema,
  tagNames: [...(defaultSchema.tagNames ?? []), "input"],
  attributes: {
    ...defaultSchema.attributes,
    input: [["type", "checkbox"], "checked", "disabled"],
  },
};

const htmlToMarkdownProcessor = unified()
  .use(rehypeParse, { fragment: true })
  .use(rehypeSanitize, releaseNotesSanitizeSchema)
  .use(rehypeRemark)
  .use(remarkGfm)
  .use(remarkStringify, {
    bullet: "-",
    emphasis: "*",
    fences: true,
    resourceLink: true,
    setext: false,
    strong: "*",
  });

/**
 * Normalize release notes to canonical Markdown.
 * HTML is sanitized first, then converted through unified's rehype-to-remark pipeline.
 */
export async function normalizeReleaseNotes(
  body: string,
  format: ReleaseNotesFormat,
): Promise<string | null> {
  const markdown =
    format === "html" ? await htmlToMarkdown(sanitizeHtml(body)) : normalizeLineEndings(body);

  return normalizeMarkdown(markdown);
}

async function htmlToMarkdown(html: string): Promise<string> {
  const file = await htmlToMarkdownProcessor.process(html);
  return String(file);
}

function normalizeMarkdown(markdown: string): string | null {
  const trimmed = markdown.trim();
  if (!trimmed) return null;

  if (trimmed.length <= MAX_RELEASE_NOTES_LENGTH) {
    return trimmed;
  }

  return `${trimmed.slice(0, MAX_RELEASE_NOTES_LENGTH).trimEnd()}\n\n${TRUNCATED_MARKER}`;
}

function normalizeLineEndings(value: string): string {
  return value.replace(/\r\n?/g, "\n");
}
