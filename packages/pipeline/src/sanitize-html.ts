import { render } from "dom-serializer";
import type { ChildNode, Element } from "domhandler";
import { prepend, removeElement } from "domutils";
import { parseDocument } from "htmlparser2";

const ALLOWED_TAGS = new Set([
  "h1",
  "h2",
  "h3",
  "h4",
  "h5",
  "h6",
  "p",
  "br",
  "hr",
  "ul",
  "ol",
  "li",
  "a",
  "strong",
  "em",
  "b",
  "i",
  "u",
  "code",
  "pre",
  "blockquote",
  "img",
  "table",
  "thead",
  "tbody",
  "tr",
  "th",
  "td",
  "dl",
  "dt",
  "dd",
  "del",
  "ins",
  "sup",
  "sub",
]);

/** Tags stripped entirely including their children. */
const STRIP_ENTIRELY = new Set([
  "script",
  "style",
  "iframe",
  "object",
  "embed",
  "form",
  "input",
  "textarea",
  "select",
  "button",
  "noscript",
]);

function isHttpUrl(url: string): boolean {
  return url.startsWith("https://") || url.startsWith("http://");
}

function isElementNode(node: ChildNode): node is Element {
  const t = node.type;
  return t === "tag" || t === "script" || t === "style";
}

/**
 * Sanitize HTML using an allowlist of tags and attributes.
 * Dangerous tags (script, style, etc.) are removed with all children.
 * Unknown tags are replaced by their children (content preserved).
 */
export function sanitizeHtml(html: string): string {
  const doc = parseDocument(html);

  function walk(nodes: ChildNode[]): void {
    // Iterate in reverse so removals don't shift indices
    for (let i = nodes.length - 1; i >= 0; i--) {
      const node = nodes[i]!;

      if (isElementNode(node)) {
        const tagName = node.tagName.toLowerCase();

        if (STRIP_ENTIRELY.has(tagName)) {
          removeElement(node);
          continue;
        }

        if (!ALLOWED_TAGS.has(tagName)) {
          // Replace with children (unwrap)
          const children = node.children.slice();
          for (const child of children) {
            prepend(node, child);
          }
          removeElement(node);
          // Walk the promoted children
          walk(children);
          continue;
        }

        // Sanitize attributes
        sanitizeAttributes(node);

        // Recurse into children
        if (node.children.length > 0) {
          walk(node.children as ChildNode[]);
        }
      }
    }
  }

  walk(doc.children as ChildNode[]);
  return render(doc);
}

function sanitizeAttributes(el: Element): void {
  const tagName = el.tagName.toLowerCase();
  const newAttribs: Record<string, string> = {};

  if (tagName === "a") {
    const href = el.attribs["href"];
    if (href && isHttpUrl(href)) {
      newAttribs["href"] = href;
    }
    newAttribs["rel"] = "noopener noreferrer";
    newAttribs["target"] = "_blank";
  } else if (tagName === "img") {
    const src = el.attribs["src"];
    if (src && src.startsWith("https://")) {
      newAttribs["src"] = src;
    }
    const alt = el.attribs["alt"];
    if (alt) {
      newAttribs["alt"] = alt;
    }
  }

  el.attribs = newAttribs;
}
