/** Canonical email template fields — one shape for preview, persist, and send. */

import { publicizeHtmlMediaUrls, publicizeMediaUrl } from "./media-public-url.js";
import { sanitizeEmailTemplateFields } from "./email-outbound-html.js";

export type TemplateFields = Record<string, unknown>;

/** Visible text length after stripping tags — aligned with Python fields_are_usable. */
export const MIN_EMAIL_BODY_VISIBLE_CHARS = 40;

export function emailHtmlVisibleTextLength(html: string): number {
  return String(html || "")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim().length;
}

export function compiledHtmlIsMeaningful(html: unknown): boolean {
  const trimmed = String(html ?? "").trim();
  if (!trimmed) return false;
  return emailHtmlVisibleTextLength(trimmed) >= MIN_EMAIL_BODY_VISIBLE_CHARS;
}

function normText(value: unknown): string {
  return String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");
}

function sectionType(section: unknown): string {
  if (!section || typeof section !== "object" || Array.isArray(section)) return "";
  return String((section as Record<string, unknown>).type ?? "text")
    .trim()
    .toLowerCase();
}

function sectionContentKey(section: Record<string, unknown>): string {
  const kind = sectionType(section);
  const content = normText(section.content);
  const label = normText(section.label);
  const items = Array.isArray(section.items)
    ? section.items.map((item) => normText(item)).join("|")
    : "";
  return `${kind}|${content}|${label}|${items}`;
}

/** Lone https URL suitable for hero <img> (not merge tags or campaign landings). */
export function isHttpImageUrl(value: unknown): boolean {
  const url = String(value ?? "").trim();
  if (!url || /\{\{|\}\}/.test(url) || /\s/.test(url) || /campaign_url/i.test(url)) {
    return false;
  }
  // Relative campaign media paths are valid heroes (absolutized at render/store).
  if (url.startsWith("/api/media/") || url.startsWith("/media/")) return true;
  if (!/^https?:\/\//i.test(url)) return false;
  try {
    const parsed = new URL(url);
    const host = parsed.hostname.toLowerCase();
    const path = parsed.pathname || "/";
    if (
      parsed.searchParams.has("wt") ||
      parsed.searchParams.has("utm_source") ||
      parsed.searchParams.has("utm_campaign")
    ) {
      return false;
    }
    const landingHosts = new Set([
      "worktual.co.uk",
      "www.worktual.co.uk",
      "rebuild-campaign.worktual.com",
    ]);
    if (landingHosts.has(host)) {
      if (path === "/" || path === "") return false;
      if (
        parsed.searchParams.has("wt") ||
        parsed.searchParams.has("utm_source") ||
        parsed.searchParams.has("utm_campaign")
      ) {
        return false;
      }
    }
    if (path.includes("/media/") || path.includes("/api/media/")) return true;
    if (/\.(jpe?g|png|gif|webp|svg)(\?|$)/i.test(path)) return true;
    if (!landingHosts.has(host)) return true;
    return false;
  } catch {
    return false;
  }
}

function resolveFlatHeroUrl(fields: TemplateFields): string {
  for (const key of [
    "header_image",
    "image_url",
    "image",
    "header_media_url",
    "media_url",
  ]) {
    const url = String(fields[key] ?? "").trim();
    if (isHttpImageUrl(url)) return url;
  }
  return "";
}

function sectionImageUrl(row: Record<string, unknown>): string {
  const kind = sectionType(row);
  const url = String(row.url ?? "").trim();
  const content = String(row.content ?? "").trim();
  if (kind === "image") {
    if (isHttpImageUrl(url)) return url;
    if (isHttpImageUrl(content)) return content;
    return "";
  }
  if (isHttpImageUrl(content)) return content;
  if (isHttpImageUrl(url)) return url;
  return "";
}

function defaultImageInsertIndex(sections: Record<string, unknown>[]): number {
  const headlineIdx = sections.findIndex((s) => sectionType(s) === "headline");
  return headlineIdx >= 0 ? headlineIdx + 1 : 0;
}

/**
 * Ensure hero URLs render as type:image sections — never raw URL text in Gmail.
 * Promotes URL-only text rows, drops duplicate URL text, inserts image after headline.
 */
export function normalizeEmailHeroSections(
  sections: unknown[],
  heroHint = "",
): unknown[] {
  const rows: Record<string, unknown>[] = [];
  for (const raw of sections) {
    if (raw && typeof raw === "object" && !Array.isArray(raw)) {
      rows.push({ ...(raw as Record<string, unknown>) });
    } else {
      rows.push(raw as Record<string, unknown>);
    }
  }

  let hero = String(heroHint || "").trim();
  if (!isHttpImageUrl(hero)) hero = "";
  for (const row of rows) {
    if (!row || typeof row !== "object" || Array.isArray(row)) continue;
    const img = sectionImageUrl(row);
    if (img) hero = hero || img;
  }

  const out: unknown[] = [];
  let heroPlaced = false;

  for (const row of rows) {
    if (!row || typeof row !== "object" || Array.isArray(row)) {
      out.push(row);
      continue;
    }
    const kind = sectionType(row);
    const content = String(row.content ?? "").trim();
    const url = String(row.url ?? "").trim();
    const hasItems = Array.isArray(row.items) && row.items.length > 0;
    const hasLabel = Boolean(String(row.label ?? "").trim());
    const imgUrl = sectionImageUrl(row);

    if (
      hero &&
      (kind === "text" || kind === "") &&
      !hasItems &&
      !hasLabel &&
      (content === hero || url === hero)
    ) {
      continue;
    }

    if (
      imgUrl &&
      (kind === "image" ||
        ((kind === "text" || kind === "") &&
          isHttpImageUrl(content) &&
          !hasItems &&
          !hasLabel))
    ) {
      out.push({
        ...row,
        type: "image",
        url: imgUrl,
        content: imgUrl,
      });
      heroPlaced = true;
      hero = hero || imgUrl;
      continue;
    }

    if (kind === "image" && imgUrl) {
      out.push({ ...row, type: "image", url: imgUrl, content: imgUrl });
      heroPlaced = true;
      continue;
    }

    out.push(row);
  }

  const objectRows = out.filter(
    (r): r is Record<string, unknown> =>
      Boolean(r && typeof r === "object" && !Array.isArray(r)),
  );
  const hasImage = objectRows.some(
    (r) => sectionType(r) === "image" && sectionImageUrl(r),
  );

  if (hero && !heroPlaced && !hasImage) {
    const insertAt = defaultImageInsertIndex(objectRows);
    out.splice(insertAt, 0, { type: "image", url: hero, content: hero });
  }

  return out;
}

/** Drop back-to-back duplicate text/headline sections (common after chat edits). */
export function dedupeEmailSections(sections: unknown[]): unknown[] {
  const out: unknown[] = [];
  let prevKey = "";
  for (const raw of sections) {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
      out.push(raw);
      prevKey = "";
      continue;
    }
    const row = raw as Record<string, unknown>;
    const kind = sectionType(row);
    const key = sectionContentKey(row);
    const isCopy = kind === "text" || kind === "headline" || kind === "";
    if (isCopy && key && key === prevKey) {
      continue;
    }
    out.push(row);
    prevKey = isCopy ? key : "";
  }
  return out;
}

function syncFlatHeroFields(out: TemplateFields): void {
  const flat = resolveFlatHeroUrl(out);
  const sections = Array.isArray(out.sections) ? out.sections : [];
  let hero = flat;
  for (const raw of sections) {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) continue;
    const img = sectionImageUrl(raw as Record<string, unknown>);
    if (img) {
      hero = hero || img;
      break;
    }
  }
  if (hero) {
    const pub = publicizeMediaUrl(hero);
    out.header_image = pub;
    out.image_url = pub;
    if (Array.isArray(out.sections)) {
      out.sections = out.sections.map((raw) => {
        if (!raw || typeof raw !== "object" || Array.isArray(raw)) return raw;
        const row = { ...(raw as Record<string, unknown>) };
        const img = sectionImageUrl(row);
        if (img) {
          const pubImg = publicizeMediaUrl(img);
          row.url = pubImg;
          if (isHttpImageUrl(String(row.content ?? "").trim()) || sectionType(row) === "image") {
            row.content = pubImg;
          }
        }
        return row;
      });
    }
  } else {
    out.header_image = "";
    out.image_url = "";
    delete out.headerImage;
    delete out.hero_image;
    delete out.heroImage;
    delete out.image;
    delete out.header_media_url;
    delete out.media_url;
  }
}

function stampPublicHtml(out: TemplateFields): TemplateFields {
  const compiled = String(out.compiled_html ?? "").trim();
  if (compiled) out.compiled_html = publicizeHtmlMediaUrls(compiled);
  const html = String(out.html ?? "").trim();
  if (html) out.html = publicizeHtmlMediaUrls(html);
  return out;
}

/**
 * Designed emails use sections[] only at send time.
 * Clear stale flat body fields, normalize hero image shape for outbound HTML.
 */
export function canonicalizeEmailTemplateFields(
  fields: TemplateFields,
): TemplateFields {
  const out: TemplateFields = {
    ...(sanitizeEmailTemplateFields(fields as Record<string, unknown>) as TemplateFields),
  };
  const sections = Array.isArray(out.sections) ? [...out.sections] : [];

  if (sections.length > 0) {
    const heroHint = resolveFlatHeroUrl(out);
    out.sections = normalizeEmailHeroSections(
      dedupeEmailSections(sections),
      heroHint ? publicizeMediaUrl(heroHint) : "",
    );
    syncFlatHeroFields(out);
    out.greeting = "";
    out.paragraphs = [];
    out.body = "";
    out.signoff = "";
    out.footer = "";
    delete out.blocks;
    const compiled = String(out.compiled_html ?? out.html ?? "").trim();
    if (compiled && !compiledHtmlIsMeaningful(compiled)) {
      delete out.compiled_html;
      delete out.html;
    }
    return stampPublicHtml(out);
  }

  for (const key of [
    "header_image",
    "image_url",
    "image",
    "header_media_url",
    "media_url",
  ]) {
    const v = String(out[key] ?? "").trim();
    if (v) out[key] = publicizeMediaUrl(v);
  }

  const greeting = String(out.greeting ?? "").trim();
  const paragraphs = Array.isArray(out.paragraphs)
    ? out.paragraphs.map((p) => String(p ?? "").trim()).filter(Boolean)
    : [];
  if (greeting && paragraphs.length && normText(paragraphs[0]) === normText(greeting)) {
    out.paragraphs = paragraphs.slice(1);
  }
  return stampPublicHtml(out);
}
