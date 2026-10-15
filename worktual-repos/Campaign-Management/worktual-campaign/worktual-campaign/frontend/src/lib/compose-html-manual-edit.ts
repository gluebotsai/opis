/** Tiny DOM helpers for Phase 2 compiled_html manual edit (not chat intent). */

import { rewriteHtmlMediaUrlsForPreview, injectSrcDocBaseHref } from "@/lib/template-preview-images";

export type FooterAlign = "left" | "center" | "right";

const UNSUB_HREF = "{{unsubscribe_url}}";
const PREVIEW_UNSUB_HREF = "#unsubscribe";

const UNSUB_FOOTER_HTML =
  '<p style="margin-top:16px;font-size:12px;color:#666;text-align:center">' +
  `<a href="${UNSUB_HREF}" style="color:#666;text-decoration:underline">Unsubscribe</a></p>`;

function parseDoc(html: string): Document {
  const parser = new DOMParser();
  const full = /<html[\s>]/i.test(html);
  return parser.parseFromString(
    full ? html : `<!DOCTYPE html><html><body>${html}</body></html>`,
    "text/html",
  );
}

function serializeDoc(doc: Document, original: string): string {
  const htmlOut = doc.documentElement.outerHTML;
  const hadDoctype = /<!DOCTYPE/i.test(original);
  const hadHtml = /<html[\s>]/i.test(original);
  if (hadHtml || hadDoctype) {
    return `${hadDoctype ? "<!DOCTYPE html>\n" : ""}${htmlOut}`;
  }
  return doc.body.innerHTML;
}

function firstHeroImg(doc: Document): HTMLImageElement | null {
  const imgs = Array.from(doc.body.querySelectorAll("img"));
  return imgs[0] || null;
}

function firstHeading(doc: Document): HTMLElement | null {
  return (
    doc.body.querySelector("h1, h2, h3, h4") ||
    (doc.body.querySelector("td[style*='font-size'] strong") as HTMLElement | null)
  );
}

function isUnsubscribe(el: Element): boolean {
  const t = (el.textContent || "").toLowerCase();
  const href = (el.getAttribute("href") || "").toLowerCase();
  return (
    t.includes("unsubscribe") ||
    href.includes("unsubscribe") ||
    href.includes("unsubscribe_url")
  );
}

function firstCtaAnchor(doc: Document): HTMLAnchorElement | null {
  const links = Array.from(doc.body.querySelectorAll("a[href]"));
  return (
    links.find((a) => !isUnsubscribe(a) && (a.getAttribute("href") || "").trim()) ||
    null
  );
}

function stripEditorArtifacts(doc: Document): void {
  doc.querySelectorAll("base").forEach((el) => el.remove());
  doc.documentElement.removeAttribute("contenteditable");
  doc.body?.removeAttribute("contenteditable");
  doc.documentElement.removeAttribute("designmode");
  doc.body?.removeAttribute("spellcheck");
  doc.querySelectorAll("style").forEach((styleEl) => {
    const css = styleEl.textContent || "";
    if (css && /;\s+\/\s*[^/\s*]/.test(css)) {
      styleEl.textContent = css.replace(
        /;\s+\/\s*([^/*\n][^/\n]*?)\s*\/(?!\/)/g,
        "; /* $1 */",
      );
    }
  });
}

/** Strip preview/editor junk — aligned with backend email-outbound-html.ts */
export function sanitizeCompiledHtmlForStorageAndSend(html: string): string {
  const source = String(html || "").trim();
  if (!source) return source;
  const doc = parseDoc(stripStockComposeImages(source));
  stripEditorArtifacts(doc);
  doc.querySelectorAll("a[href]").forEach((el) => {
    if (!(el instanceof HTMLAnchorElement)) return;
    const href = (el.getAttribute("href") || "").trim();
    if (
      href === PREVIEW_UNSUB_HREF ||
      href === "#unsubscribe" ||
      href.includes("#unsubscribe")
    ) {
      el.setAttribute("href", UNSUB_HREF);
      if (!(el.textContent || "").trim()) el.textContent = "Unsubscribe";
    }
  });
  let out = serializeDoc(doc, source);
  out = out.replace(
    /href=(["'])#unsubscribe\1/gi,
    `href=$1${UNSUB_HREF}$1`,
  );
  return ensureComposeUnsubscribeLink(out);
}

function footerRoot(doc: Document): HTMLElement | null {
  const marked =
    doc.body.querySelector("footer") ||
    doc.body.querySelector("[id*='footer' i], [class*='footer' i]");
  if (marked instanceof HTMLElement) return marked;
  const unsub = Array.from(doc.body.querySelectorAll("a, p")).find(isUnsubscribe);
  if (unsub instanceof HTMLElement) {
    return (
      (unsub.closest("td") as HTMLElement | null) ||
      (unsub.closest("table") as HTMLElement | null) ||
      unsub
    );
  }
  const tables = Array.from(doc.body.querySelectorAll("table"));
  const last = tables[tables.length - 1];
  return last || null;
}

export function inspectComposeHtml(html: string): {
  heroUrl: string;
  heading: string;
  ctaLabel: string;
  ctaHref: string;
  background: string;
  footerAlign: FooterAlign;
  hasUnsubscribeLink: boolean;
} {
  const doc = parseDoc(html || "<html><body></body></html>");
  const img = firstHeroImg(doc);
  const headingEl = firstHeading(doc);
  const cta = firstCtaAnchor(doc);
  const bodyBg =
    doc.body.getAttribute("bgcolor") ||
    doc.body.style.backgroundColor ||
    "";
  const foot = footerRoot(doc);
  const alignRaw = (
    foot?.getAttribute("align") ||
    foot?.style.textAlign ||
    "center"
  ).toLowerCase();
  const unsub = Array.from(doc.body.querySelectorAll("a")).find(isUnsubscribe);
  const footerAlign: FooterAlign =
    alignRaw === "left" || alignRaw === "right" ? alignRaw : "center";
  return {
    heroUrl: String(img?.getAttribute("src") || "").trim(),
    heading: String(headingEl?.textContent || "").trim(),
    ctaLabel: String(cta?.textContent || "").trim(),
    ctaHref: String(cta?.getAttribute("href") || "").trim(),
    background: bodyBg.trim(),
    footerAlign,
    hasUnsubscribeLink: Boolean(unsub),
  };
}

export function setComposeHeroUrl(html: string, url: string): string {
  const doc = parseDoc(html);
  const img = firstHeroImg(doc);
  const next = url.trim();
  if (img) {
    if (next) img.setAttribute("src", next);
    else img.remove();
  } else if (next) {
    const node = doc.createElement("img");
    node.setAttribute("src", next);
    node.setAttribute("alt", "");
    node.setAttribute("width", "600");
    node.style.maxWidth = "100%";
    node.style.height = "auto";
    node.style.display = "block";
    const heading = firstHeading(doc);
    if (heading?.parentElement) {
      heading.parentElement.insertBefore(node, heading);
    } else {
      doc.body.insertBefore(node, doc.body.firstChild);
    }
  }
  return serializeDoc(doc, html);
}

export function setComposeHeading(html: string, text: string): string {
  const doc = parseDoc(html);
  const heading = firstHeading(doc);
  if (heading) heading.textContent = text;
  return serializeDoc(doc, html);
}

export function setComposeCta(
  html: string,
  label: string,
  href: string,
): string {
  const doc = parseDoc(html);
  const cta = firstCtaAnchor(doc);
  if (cta) {
    if (label.trim()) cta.textContent = label.trim();
    if (href.trim()) cta.setAttribute("href", href.trim());
  }
  return serializeDoc(doc, html);
}

export function setComposeBackground(html: string, color: string): string {
  const doc = parseDoc(html);
  const c = color.trim();
  if (c) {
    doc.body.setAttribute("bgcolor", c);
    doc.body.style.backgroundColor = c;
  }
  return serializeDoc(doc, html);
}

export function ensureComposeUnsubscribeLink(html: string): string {
  const source = String(html || "");
  if (!source.trim()) return source;
  const doc = parseDoc(source);
  const existing = Array.from(doc.body.querySelectorAll("a")).filter(isUnsubscribe);
  const keep = existing[0];
  if (keep instanceof HTMLAnchorElement) {
    keep.setAttribute("href", UNSUB_HREF);
    if (!(keep.textContent || "").trim()) keep.textContent = "Unsubscribe";
    if (!keep.style.textDecoration) {
      keep.style.textDecoration = "underline";
    }
    if (!keep.style.color) keep.style.color = "#666";
    existing.slice(1).forEach((el) => {
      if (!(el instanceof HTMLAnchorElement)) return;
      const label = (el.textContent || "").trim().toLowerCase();
      if (label && label !== "unsubscribe") return;
      const p = el.closest("p");
      if (p && p.querySelectorAll("a").length === 1) p.remove();
      else el.remove();
    });
    return serializeDoc(doc, source);
  }
  const walker = doc.createTreeWalker(doc.body, NodeFilter.SHOW_TEXT);
  let node: Node | null = walker.nextNode();
  while (node) {
    const value = node.textContent || "";
    if (/\{\{\s*unsubscribe_url\s*\}\}/i.test(value)) {
      const wrap = doc.createElement("a");
      wrap.setAttribute("href", UNSUB_HREF);
      wrap.setAttribute("style", "color:#666;text-decoration:underline");
      wrap.textContent = "Unsubscribe";
      const parent = node.parentNode;
      if (parent) parent.replaceChild(wrap, node);
      return serializeDoc(doc, source);
    }
    node = walker.nextNode();
  }
  const chunk = doc.createElement("div");
  chunk.innerHTML = UNSUB_FOOTER_HTML;
  const insert = chunk.firstElementChild;
  if (insert) doc.body.appendChild(insert);
  return serializeDoc(doc, source);
}

export function stripStockComposeImages(html: string): string {
  const source = String(html || "");
  if (!source.trim()) return source;
  const doc = parseDoc(source);
  const stock =
    /gstatic\.com|googleusercontent\.com|ggpht\.com|unsplash\.com|picsum\.photos|loremflickr\.com|placeholder\.com|placehold\.co|placehold\.it|dummyimage\.com|via\.placeholder\.com|placekitten\.com/i;
  doc.querySelectorAll("img").forEach((el) => {
    const src = el.getAttribute("src") || "";
    if (stock.test(src)) el.remove();
  });
  return serializeDoc(doc, source);
}

export function previewComposeHtml(html: string, origin?: string): string {
  const cleaned = stripStockComposeImages(html);
  const ensured = ensureComposeUnsubscribeLink(cleaned);
  const withMedia = rewriteHtmlMediaUrlsForPreview(ensured);
  const withUnsub = withMedia.replace(
    /\{\{\s*unsubscribe_url\s*\}\}/gi,
    PREVIEW_UNSUB_HREF,
  );
  return injectSrcDocBaseHref(withUnsub, origin);
}

export function persistComposeHtml(html: string, original = html): string {
  void original;
  return sanitizeCompiledHtmlForStorageAndSend(html);
}

export function setComposeFooterAlign(
  html: string,
  align: FooterAlign,
): string {
  const withLink = ensureComposeUnsubscribeLink(html);
  const doc = parseDoc(withLink);
  const foot = footerRoot(doc);
  if (foot) {
    foot.setAttribute("align", align);
    foot.style.textAlign = align;
    foot.querySelectorAll("p, td, a").forEach((el) => {
      if (el instanceof HTMLElement) {
        el.style.textAlign = align;
        if (el.tagName === "TD" || el.tagName === "TABLE") {
          el.setAttribute("align", align);
        }
      }
    });
  }
  return persistComposeHtml(serializeDoc(doc, withLink), withLink);
}

export function serializeIframeDocument(
  doc: Document,
  original: string,
): string {
  return persistComposeHtml(serializeDoc(doc, original), original);
}
