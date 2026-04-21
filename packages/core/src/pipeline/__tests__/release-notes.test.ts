import { describe, it, expect } from "vite-plus/test";

import { normalizeReleaseNotes } from "../release-notes";
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
});

describe("normalizeReleaseNotes", () => {
  it("converts markdown to sanitized HTML", () => {
    const md = "## Changes\n- New feature\n- Bug fix";
    const result = normalizeReleaseNotes(md, "markdown");
    expect(result).toContain("<h2>");
    expect(result).toContain("Changes");
    expect(result).toContain("<li>");
    expect(result).toContain("New feature");
  });

  it("sanitizes HTML input", () => {
    const html = '<h2>Notes</h2><script>alert("xss")</script><p>Safe content</p>';
    const result = normalizeReleaseNotes(html, "html");
    expect(result).toContain("<h2>Notes</h2>");
    expect(result).toContain("<p>Safe content</p>");
    expect(result).not.toContain("<script>");
  });

  it("truncates oversized content", () => {
    const html = "<p>" + "x".repeat(600_000) + "</p>";
    const result = normalizeReleaseNotes(html, "html");
    expect(result.length).toBeLessThan(600_000);
    expect(result).toContain("<!-- truncated -->");
  });

  it("converts markdown links to sanitized anchors", () => {
    const md = "[Click here](https://example.com)";
    const result = normalizeReleaseNotes(md, "markdown");
    expect(result).toContain('href="https://example.com"');
    expect(result).toContain('rel="noopener noreferrer"');
  });
});
