import { describe, it, expect } from "vite-plus/test";

import { normalizeReleaseNotes } from "../release-notes";
import { renderReleaseNotesHtml, renderReleaseNotesMarkdownHtml } from "../release-notes-render";
import { sanitizeHtml } from "../sanitize-html";

describe("sanitizeHtml", () => {
  it("allows safe tags", () => {
    const html = "<h2>Title</h2><p>Hello <strong>world</strong></p>";
    expect(sanitizeHtml(html)).toBe(html);
  });

  it("strips script tags entirely", () => {
    const html = '<p>Hello</p><script>alert("xss")</script><p>World</p>';
    expect(sanitizeHtml(html)).toBe("<p>Hello</p><p>World</p>");
  });

  it("strips style tags entirely", () => {
    const html = "<style>body { color: red }</style><p>Text</p>";
    expect(sanitizeHtml(html)).toBe("<p>Text</p>");
  });

  it("unwraps unknown tags but preserves content", () => {
    const html = "<div><p>Inside div</p></div>";
    expect(sanitizeHtml(html)).toBe("<p>Inside div</p>");
  });

  it("adds rel and target to anchor tags", () => {
    const html = '<a href="https://example.com">Link</a>';
    expect(sanitizeHtml(html)).toBe(
      '<a href="https://example.com" rel="noopener noreferrer" target="_blank">Link</a>',
    );
  });

  it("strips non-http hrefs from anchors", () => {
    const html = '<a href="javascript:alert(1)">Bad</a>';
    const result = sanitizeHtml(html);
    expect(result).not.toContain("javascript:");
    expect(result).toContain("rel=");
  });

  it("allows https img src and alt", () => {
    const html = '<img src="https://example.com/img.png" alt="Photo" class="big">';
    const result = sanitizeHtml(html);
    expect(result).toContain('src="https://example.com/img.png"');
    expect(result).toContain('alt="Photo"');
    expect(result).not.toContain("class=");
  });

  it("strips all attributes from non-a/img tags", () => {
    const html = '<p class="foo" id="bar" onclick="evil()">Text</p>';
    expect(sanitizeHtml(html)).toBe("<p>Text</p>");
  });

  it("strips iframe tags entirely", () => {
    const html = '<p>Before</p><iframe src="https://evil.com"></iframe><p>After</p>';
    expect(sanitizeHtml(html)).toBe("<p>Before</p><p>After</p>");
  });

  it("allows only safe checkbox inputs", () => {
    const html = '<input type="checkbox" checked onclick="evil()"><input type="text" value="bad">';
    expect(sanitizeHtml(html)).toBe('<input type="checkbox" disabled checked>');
  });
});

describe("normalizeReleaseNotes", () => {
  it("passes markdown through as canonical release notes", async () => {
    const md = "## Changes\n- New feature\n- Bug fix";
    const result = await normalizeReleaseNotes(md, "markdown");
    expect(result).toBe(md);
  });

  it("converts sanitized HTML input to markdown", async () => {
    const html = '<h2>Notes</h2><script>alert("xss")</script><p>Safe content</p>';
    const result = await normalizeReleaseNotes(html, "html");
    expect(result).toContain("## Notes");
    expect(result).toContain("Safe content");
    expect(result).not.toContain("<script>");
  });

  it("converts GFM tables, task lists, and strikethrough", async () => {
    const html = `
      <table>
        <tr><td>Feature</td><td>Status</td></tr>
        <tr><td>Markdown notes</td><td>Done</td></tr>
      </table>
      <ul>
        <li><input type="checkbox" checked>Shipped</li>
        <li><input type="checkbox">Pending</li>
      </ul>
      <p><del>Removed</del></p>
    `;
    const result = await normalizeReleaseNotes(html, "html");

    expect(result).toContain("|                |        |");
    expect(result).toContain("| -------------- | ------ |");
    expect(result).toContain("| Feature        | Status |");
    expect(result).toContain("| Markdown notes | Done   |");
    expect(result).toContain("- [x] Shipped");
    expect(result).toContain("- [ ] Pending");
    expect(result).toContain("~~Removed~~");
  });

  it("truncates oversized content", async () => {
    const markdown = "x".repeat(600_000);
    const result = await normalizeReleaseNotes(markdown, "markdown");
    expect(result).not.toBeNull();
    expect(result!.length).toBeLessThan(600_000);
    expect(result).toContain("<!-- truncated -->");
  });

  it("returns null when HTML conversion produces no content", async () => {
    await expect(
      normalizeReleaseNotes('<script>alert("xss")</script>', "html"),
    ).resolves.toBeNull();
  });
});

describe("release note rendering", () => {
  it("renders markdown to sanitized HTML", () => {
    const result = renderReleaseNotesMarkdownHtml("[Click here](https://example.com)");
    expect(result).toContain('href="https://example.com"');
    expect(result).toContain('rel="noopener noreferrer"');
  });

  it("sanitizes scripts and unsafe links when rendering markdown", () => {
    const result = renderReleaseNotesMarkdownHtml(
      '[Bad](javascript:alert("xss"))<script>alert("xss")</script>',
    );
    expect(result).not.toContain("javascript:");
    expect(result).not.toContain("<script>");
    expect(result).toContain(">Bad</a>");
  });

  it("sanitizes legacy HTML fallback before display", () => {
    const result = renderReleaseNotesHtml('<p>Safe</p><script>alert("xss")</script>');
    expect(result).toBe("<p>Safe</p>");
  });
});
