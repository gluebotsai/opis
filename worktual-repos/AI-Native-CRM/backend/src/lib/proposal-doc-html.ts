/**
 * Frozen proposal-doc HTML: persist inline edits without rewriting layout.
 */

import { formatSectionBodyHtml } from "@/lib/document-blueprint";
import type { ProposalSection } from "@/lib/proposal-sections";

const MAX_HTML_CHARS = 1_500_000;

export function sanitizeProposalDocHtml(html: string): string {
  return html
    .replace(/<script\b[\s\S]*?<\/script>/gi, "")
    .replace(/<iframe\b[\s\S]*?<\/iframe>/gi, "")
    .replace(/\son[a-z]+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, "")
    .replace(/javascript:/gi, "");
}

export function isProposalDocHtml(html: string): boolean {
  return /<article\b[^>]*class="[^"]*proposal-doc/i.test(html);
}

export function mergeProposalDocHtml(stored: string, nextArticle: string): string {
  const sanitized = sanitizeProposalDocHtml(nextArticle).trim();
  if (!sanitized || sanitized.length > MAX_HTML_CHARS) {
    throw new Error("Document HTML is empty or too large.");
  }
  if (!/<article\b/i.test(sanitized)) {
    throw new Error("Edited HTML must include the proposal document.");
  }
  if (/<article\b[^>]*class="[^"]*proposal-doc/i.test(stored)) {
    return stored.replace(
      /<article\b[^>]*class="[^"]*proposal-doc[\s\S]*?<\/article>/i,
      sanitized,
    );
  }
  if (/<article\b/i.test(stored)) {
    return stored.replace(/<article\b[\s\S]*?<\/article>/i, sanitized);
  }
  return sanitized;
}

function stripTags(html: string): string {
  return html
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>/gi, "\n\n")
    .replace(/<\/li>/gi, "\n")
    .replace(/<li[^>]*>/gi, "• ")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function attrValue(attrs: string, name: string): string {
  const match = new RegExp(`${name}\\s*=\\s*"([^"]*)"`, "i").exec(attrs);
  return match?.[1]?.trim() || "";
}

export function sectionsFromProposalDocHtml(
  html: string,
  existing: ProposalSection[],
): ProposalSection[] {
  const byKey = new Map(existing.map((row) => [row.key, row]));
  const out: ProposalSection[] = [];
  const re = /<section\b([^>]*)>([\s\S]*?)<\/section>/gi;
  let match: RegExpExecArray | null;
  let index = 0;
  while ((match = re.exec(html))) {
    const attrs = match[1] || "";
    const inner = match[2] || "";
    const slot =
      attrValue(attrs, "data-slot") ||
      attrValue(attrs, "data-sec") ||
      `section_${index + 1}`;
    const headingMatch = /<h[12][^>]*>([\s\S]*?)<\/h[12]>/i.exec(inner);
    const title =
      stripTags(headingMatch?.[1] || "").trim() ||
      byKey.get(slot)?.title ||
      "Section";
    const bodyInner = inner.replace(/<h[12][^>]*>[\s\S]*?<\/h[12]>/i, "");
    const prev = byKey.get(slot);
    out.push({
      id: prev?.id || slot,
      key: slot,
      title: title.slice(0, 200),
      body: stripTags(bodyInner).slice(0, 8000),
      sortOrder: index + 1,
      ...(prev?.tableRows ? { tableRows: prev.tableRows } : {}),
    });
    index += 1;
  }
  return out.length ? out : existing;
}

function normalizeLabel(value: string): string {
  return value
    .toLowerCase()
    .replace(/^\d+\.\s*/, "")
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Replace one section body in frozen proposal-doc HTML (keeps headings/layout). */
export function applySectionToProposalDocHtml(
  html: string,
  section: { key: string; title?: string | null; body: string },
): string {
  const keyNorm = normalizeLabel(section.key);
  const titleNorm = normalizeLabel(section.title || "");
  const bodyHtml = formatSectionBodyHtml(section.body);
  if (!keyNorm || !bodyHtml) return html;
  let applied = false;
  const next = html.replace(
    /<section\b([^>]*)>([\s\S]*?)<\/section>/gi,
    (full, attrs: string, inner: string) => {
      if (applied) return full;
      const slot = normalizeLabel(
        attrValue(attrs, "data-slot") || attrValue(attrs, "data-sec"),
      );
      const headingMatch = /<h[12]\b[^>]*>([\s\S]*?)<\/h[12]>/i.exec(inner);
      const headingNorm = normalizeLabel(stripTags(headingMatch?.[1] || ""));
      const hit =
        (slot && (slot === keyNorm || (titleNorm && slot === titleNorm))) ||
        (headingNorm &&
          (headingNorm === keyNorm ||
            (titleNorm && headingNorm === titleNorm) ||
            (keyNorm.length >= 4 && headingNorm.includes(keyNorm)) ||
            (titleNorm.length >= 4 && headingNorm.includes(titleNorm))));
      if (!hit) return full;
      applied = true;
      let nextInner = inner;
      if (/data-slot-body|bp-slot-body/i.test(inner)) {
        nextInner = inner.replace(
          /(<div[^>]*(?:data-slot-body|bp-slot-body)[^>]*>)([\s\S]*?)(<\/div>)/i,
          (_m, open: string, _old: string, close: string) =>
            `${open}${bodyHtml}${close}`,
        );
      } else if (headingMatch?.[0]) {
        nextInner = inner.replace(
          /(<h[12]\b[^>]*>[\s\S]*?<\/h[12]>)([\s\S]*)/i,
          `$1${bodyHtml}`,
        );
      } else {
        nextInner = bodyHtml;
      }
      return `<section${attrs}>${nextInner}</section>`;
    },
  );
  return applied ? next : html;
}

/** Prefer on-page HTML bodies when rewriting a frozen proposal-doc. */
export function mergeVisibleSectionBodies(
  stored: ProposalSection[],
  visible: ProposalSection[],
): ProposalSection[] {
  const used = new Set<string>();
  const out = stored.map((row) => {
    const hit = visible.find((item) => {
      const sameKey = normalizeLabel(item.key) === normalizeLabel(row.key);
      const sameTitle =
        Boolean(item.title) &&
        Boolean(row.title) &&
        normalizeLabel(item.title) === normalizeLabel(row.title);
      return sameKey || sameTitle;
    });
    if (!hit) return row;
    used.add(normalizeLabel(hit.key) || hit.id);
    const body = (hit.body || "").trim();
    if (!body) return row;
    return { ...row, body, title: hit.title?.trim() || row.title };
  });
  for (const extra of visible) {
    const keyNorm = normalizeLabel(extra.key);
    if (used.has(keyNorm) || out.some((row) => normalizeLabel(row.key) === keyNorm)) {
      continue;
    }
    if (!(extra.body || "").trim()) continue;
    out.push(extra);
  }
  return out;
}
