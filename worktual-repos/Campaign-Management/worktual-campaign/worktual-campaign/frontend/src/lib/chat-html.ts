/**
 * Render agent chat HTML safely.
 * Jun30 strategist prompts require HTML (<p>, <b>, <ul>, <li>, <table>, <a>, …).
 */

const ALLOWED_TAGS = new Set([
  "P",
  "B",
  "STRONG",
  "UL",
  "OL",
  "LI",
  "TABLE",
  "THEAD",
  "TBODY",
  "TR",
  "TD",
  "TH",
  "BR",
  "EM",
  "I",
  "A",
]);

const SAFE_HREF =
  /^(https?:\/\/[^\s"'<>]+|\/[^\s"'<>]*)$/i;

const INCOMPLETE_TAG_TAIL =
  /<\s*\/?\s*(?:p|b|strong|ul|ol|li|table|thead|tbody|tr|td|th|br|em|i|a)\b[^>]*$/i;

/** Drop truncated trailing tags like ``<p`` so bubbles never show raw markup. */
export function stripIncompleteTrailingTag(text: string): string {
  let t = String(text || "").trimEnd();
  t = t.replace(INCOMPLETE_TAG_TAIL, "").trimEnd();
  if (t.endsWith("<")) {
    t = t.slice(0, -1).trimEnd();
  }
  return t;
}

export function looksLikeChatHtml(text: string): boolean {
  const cleaned = stripIncompleteTrailingTag(text || "");
  return /<\s*(p|b|ul|ol|li|table|tr|td|th|br|strong|a)\b/i.test(cleaned);
}

/** True when markup is truncated / unbalanced enough to prefer plain text. */
export function looksLikeBrokenChatHtml(text: string): boolean {
  const t = String(text || "").trim();
  if (!t) return false;
  if (INCOMPLETE_TAG_TAIL.test(t) || /<\s*$/.test(t)) return true;
  // Lone angle-bracket noise with no complete allowlisted open tag.
  if (/</.test(t) && !/<\s*(p|b|ul|ol|li|table|tr|td|th|br|strong|a)\b[^>]*>/i.test(t)) {
    return true;
  }
  return false;
}

/** Strip disallowed tags/attrs; keep allowlisted structure for chat bubbles. */
export function sanitizeChatHtml(raw: string): string {
  const cleaned = stripIncompleteTrailingTag(String(raw || "").trim());
  if (typeof document === "undefined") {
    return escapeText(cleaned);
  }
  const template = document.createElement("template");
  template.innerHTML = cleaned;
  const walk = (node: Node) => {
    const children = Array.from(node.childNodes);
    for (const child of children) {
      if (child.nodeType === Node.ELEMENT_NODE) {
        const el = child as HTMLElement;
        if (!ALLOWED_TAGS.has(el.tagName)) {
          // Unwrap unknown elements (keep text/children).
          while (el.firstChild) {
            node.insertBefore(el.firstChild, el);
          }
          node.removeChild(el);
          continue;
        }
        if (el.tagName === "A") {
          const href = el.getAttribute("href") || "";
          const download = el.getAttribute("download");
          const target = el.getAttribute("target");
          for (const attr of Array.from(el.attributes)) {
            el.removeAttribute(attr.name);
          }
          if (SAFE_HREF.test(href)) {
            el.setAttribute("href", href);
            el.setAttribute("rel", "noopener noreferrer");
            if (target === "_blank") {
              el.setAttribute("target", "_blank");
            }
            if (download != null) {
              el.setAttribute(
                "download",
                download === "" ? "temporary-contact-template.csv" : download,
              );
            }
          }
        } else {
          for (const attr of Array.from(el.attributes)) {
            el.removeAttribute(attr.name);
          }
        }
        walk(el);
      } else if (child.nodeType === Node.COMMENT_NODE) {
        node.removeChild(child);
      }
    }
  };
  walk(template.content);
  return template.innerHTML;
}

function escapeText(text: string): string {
  return String(text || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
