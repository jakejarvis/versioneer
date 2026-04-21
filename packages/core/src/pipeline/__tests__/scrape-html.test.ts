import { load } from "cheerio";
import { describe, expect, it } from "vite-plus/test";

import {
  extractIconUrl,
  extractLinks,
  extractOpenGraph,
  extractTitle,
  resolveUrl,
} from "../scrape-html";

describe("extractIconUrl", () => {
  it("prefers apple-touch-icon with sizes over other sources", () => {
    const doc = load(
      '<link rel="apple-touch-icon" sizes="180x180" href="/apple-icon-180.png">' +
        '<link rel="icon" sizes="32x32" href="/favicon-32.png">' +
        '<meta property="og:image" content="https://example.com/og.png">',
    );
    expect(extractIconUrl(doc, "https://example.com")).toBe(
      "https://example.com/apple-icon-180.png",
    );
  });

  it("falls back to og:image when no apple-touch-icon", () => {
    const doc = load(
      '<meta property="og:image" content="https://example.com/og.png">' +
        '<link rel="icon" href="/favicon.ico">',
    );
    expect(extractIconUrl(doc, "https://example.com")).toBe("https://example.com/og.png");
  });

  it("falls back to link[rel=icon] with sizes when no og:image", () => {
    const doc = load(
      '<link rel="icon" type="image/png" sizes="64x64" href="/icon-64.png">' +
        '<link rel="icon" type="image/png" sizes="32x32" href="/icon-32.png">',
    );
    expect(extractIconUrl(doc, "https://example.com")).toBe("https://example.com/icon-64.png");
  });

  it("prefers SVG icons with sizes over PNG due to type bonus", () => {
    // The function gives SVG a +10000 bonus, PNG +1000 bonus, added to parsed size
    const doc = load(
      '<link rel="icon" type="image/svg+xml" sizes="16x16" href="/icon.svg">' +
        '<link rel="icon" type="image/png" sizes="128x128" href="/icon-128.png">',
    );
    // SVG: 16 + 10000 = 10016 vs PNG: 128 + 1000 = 1128
    expect(extractIconUrl(doc, "https://example.com")).toBe("https://example.com/icon.svg");
  });

  it("falls back to /favicon.ico when no icons found", () => {
    const doc = load("<html><head></head></html>");
    expect(extractIconUrl(doc, "https://example.com")).toBe("https://example.com/favicon.ico");
  });

  it("resolves relative icon URLs with sizes against base", () => {
    // apple-touch-icon needs a parseable `sizes` attr to be selected
    const doc = load('<link rel="apple-touch-icon" sizes="180x180" href="/icons/touch.png">');
    expect(extractIconUrl(doc, "https://example.com")).toBe("https://example.com/icons/touch.png");
  });

  it("picks the largest apple-touch-icon", () => {
    const doc = load(
      '<link rel="apple-touch-icon" sizes="60x60" href="/icon-60.png">' +
        '<link rel="apple-touch-icon" sizes="180x180" href="/icon-180.png">' +
        '<link rel="apple-touch-icon" sizes="120x120" href="/icon-120.png">',
    );
    expect(extractIconUrl(doc, "https://example.com")).toBe("https://example.com/icon-180.png");
  });
});

describe("extractOpenGraph", () => {
  it("extracts og: meta tags", () => {
    const doc = load(`
      <html><head>
        <meta property="og:title" content="My App">
        <meta property="og:description" content="A great app">
        <meta property="og:image" content="https://example.com/og.png">
      </head></html>
    `);
    const result = extractOpenGraph(doc);
    expect(result).toEqual({
      "og:title": "My App",
      "og:description": "A great app",
      "og:image": "https://example.com/og.png",
    });
  });

  it("returns empty object when no og tags", () => {
    const doc = load("<html><head></head></html>");
    expect(extractOpenGraph(doc)).toEqual({});
  });

  it("ignores non-og meta tags", () => {
    const doc = load(`
      <html><head>
        <meta name="description" content="Not OG">
        <meta property="og:title" content="OG Title">
      </head></html>
    `);
    const result = extractOpenGraph(doc);
    expect(result).toEqual({ "og:title": "OG Title" });
  });
});

describe("extractTitle", () => {
  it("prefers og:title over <title>", () => {
    const doc = load(`
      <html><head>
        <title>Page Title</title>
        <meta property="og:title" content="OG Title">
      </head></html>
    `);
    expect(extractTitle(doc)).toBe("OG Title");
  });

  it("falls back to <title> when no og:title", () => {
    const doc = load("<html><head><title>Page Title</title></head></html>");
    expect(extractTitle(doc)).toBe("Page Title");
  });

  it("trims whitespace", () => {
    const doc = load("<html><head><title>  Padded Title  </title></head></html>");
    expect(extractTitle(doc)).toBe("Padded Title");
  });

  it("returns null when no title found", () => {
    const doc = load("<html><head></head></html>");
    expect(extractTitle(doc)).toBeNull();
  });
});

describe("extractLinks", () => {
  it("extracts link tags by rel", () => {
    const doc = load(`
      <html><head>
        <link rel="stylesheet" href="/style.css" type="text/css">
        <link rel="icon" href="/favicon.ico" type="image/x-icon" sizes="16x16">
        <link rel="stylesheet" href="/other.css">
      </head></html>
    `);
    const stylesheets = extractLinks(doc, "stylesheet");
    expect(stylesheets).toHaveLength(2);
    expect(stylesheets[0]!.href).toBe("/style.css");
    expect(stylesheets[0]!.type).toBe("text/css");
  });

  it("returns empty array when no matching links", () => {
    const doc = load("<html><head></head></html>");
    expect(extractLinks(doc, "canonical")).toEqual([]);
  });

  it("skips links without href", () => {
    const doc = load('<html><head><link rel="icon"></head></html>');
    expect(extractLinks(doc, "icon")).toEqual([]);
  });
});

describe("resolveUrl", () => {
  it("resolves relative URL against base", () => {
    expect(resolveUrl("/path/page", "https://example.com")).toBe("https://example.com/path/page");
  });

  it("returns absolute URL unchanged", () => {
    expect(resolveUrl("https://other.com/page", "https://example.com")).toBe(
      "https://other.com/page",
    );
  });

  it("returns original href for invalid URLs", () => {
    expect(resolveUrl("://broken", "://also-broken")).toBe("://broken");
  });
});
