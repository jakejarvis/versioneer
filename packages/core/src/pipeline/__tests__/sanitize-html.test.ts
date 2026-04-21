import { describe, expect, it } from "vite-plus/test";

import { sanitizeHtml } from "../sanitize-html";

describe("sanitizeHtml", () => {
  it("preserves allowed tags", () => {
    const html = "<p>Hello <strong>world</strong></p>";
    expect(sanitizeHtml(html)).toBe("<p>Hello <strong>world</strong></p>");
  });

  it("preserves heading tags", () => {
    const html = "<h1>Title</h1><h2>Subtitle</h2>";
    expect(sanitizeHtml(html)).toBe("<h1>Title</h1><h2>Subtitle</h2>");
  });

  it("preserves list tags", () => {
    const html = "<ul><li>one</li><li>two</li></ul>";
    expect(sanitizeHtml(html)).toBe("<ul><li>one</li><li>two</li></ul>");
  });

  it("strips script tags entirely including children", () => {
    const html = "<p>Hello</p><script>alert('xss')</script><p>World</p>";
    expect(sanitizeHtml(html)).toBe("<p>Hello</p><p>World</p>");
  });

  it("strips style tags entirely including children", () => {
    const html = "<style>.evil { display: none }</style><p>Content</p>";
    expect(sanitizeHtml(html)).toBe("<p>Content</p>");
  });

  it("strips iframe tags entirely", () => {
    const html = '<iframe src="https://evil.com"></iframe><p>Safe</p>';
    expect(sanitizeHtml(html)).toBe("<p>Safe</p>");
  });

  it("strips form elements entirely", () => {
    const html = "<form><input type='text'><button>Submit</button></form><p>After</p>";
    expect(sanitizeHtml(html)).toBe("<p>After</p>");
  });

  it("unwraps unknown tags preserving their children", () => {
    const html = "<div><span>Hello</span></div>";
    expect(sanitizeHtml(html)).toBe("Hello");
  });

  it("sanitizes anchor href to only allow http/https", () => {
    const safe = '<a href="https://example.com">Link</a>';
    const result = sanitizeHtml(safe);
    expect(result).toContain('href="https://example.com"');
    expect(result).toContain('rel="noopener noreferrer"');
    expect(result).toContain('target="_blank"');
  });

  it("strips javascript: URLs from anchors", () => {
    const html = '<a href="javascript:alert(1)">Click</a>';
    const result = sanitizeHtml(html);
    expect(result).not.toContain("javascript:");
    expect(result).not.toContain("href");
  });

  it("strips all non-allowed attributes from anchors", () => {
    const html = '<a href="https://example.com" onclick="evil()" class="link">Link</a>';
    const result = sanitizeHtml(html);
    expect(result).not.toContain("onclick");
    expect(result).not.toContain("class");
    expect(result).toContain('href="https://example.com"');
  });

  it("sanitizes img to only keep https src and alt", () => {
    const html = '<img src="https://example.com/img.png" alt="Photo" class="big">';
    const result = sanitizeHtml(html);
    expect(result).toContain('src="https://example.com/img.png"');
    expect(result).toContain('alt="Photo"');
    expect(result).not.toContain("class");
  });

  it("strips http (non-https) src from img", () => {
    const html = '<img src="http://example.com/img.png" alt="Photo">';
    const result = sanitizeHtml(html);
    expect(result).not.toContain("src");
    expect(result).toContain('alt="Photo"');
  });

  it("strips onerror and other event handlers", () => {
    const html = '<img onerror="alert(1)" src="https://example.com/x.png">';
    const result = sanitizeHtml(html);
    expect(result).not.toContain("onerror");
  });

  it("strips all attributes from non-anchor/img elements", () => {
    const html = '<p class="foo" id="bar" style="color:red">Text</p>';
    const result = sanitizeHtml(html);
    expect(result).toBe("<p>Text</p>");
  });

  it("handles empty input", () => {
    expect(sanitizeHtml("")).toBe("");
  });

  it("handles plain text", () => {
    expect(sanitizeHtml("Hello world")).toBe("Hello world");
  });

  it("handles nested dangerous content", () => {
    const html = "<p>Safe <script><script>double evil</script></script></p>";
    const result = sanitizeHtml(html);
    expect(result).not.toContain("script");
    expect(result).toContain("Safe");
  });

  it("preserves table structure", () => {
    const html =
      "<table><thead><tr><th>A</th></tr></thead><tbody><tr><td>1</td></tr></tbody></table>";
    expect(sanitizeHtml(html)).toBe(html);
  });
});
