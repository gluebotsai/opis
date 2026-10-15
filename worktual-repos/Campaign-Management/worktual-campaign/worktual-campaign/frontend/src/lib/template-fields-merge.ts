/**
 * Merge partial template field patches — mirrors backend template-fields-merge.ts.
 */

import { absolutizeMediaUrl } from "@/services/media.api";

export type TemplateFieldsRecord = Record<string, unknown>;

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function sectionType(section: unknown): string {
  if (!section || typeof section !== "object" || Array.isArray(section)) return "";
  return String((section as Record<string, unknown>).type ?? "")
    .trim()
    .toLowerCase();
}

function findImageSectionIndex(sections: unknown[]): number {
  return sections.findIndex((s) => sectionType(s) === "image");
}

function defaultImageInsertIndex(sections: unknown[]): number {
  const headlineIdx = sections.findIndex((s) => sectionType(s) === "headline");
  return headlineIdx >= 0 ? headlineIdx + 1 : 0;
}

function imageSectionFromPatch(patch: Record<string, unknown>): Record<string, unknown> {
  const url = String(patch.url ?? patch.content ?? "").trim();
  return {
    type: String(patch.type ?? "image").trim() || "image",
    url,
    content: String(patch.content ?? patch.url ?? url).trim(),
  };
}

export function applySectionsPatch(
  sections: unknown[],
  patch: Record<string, unknown>,
): unknown[] {
  const out = [...sections];
  const section = imageSectionFromPatch(patch);
  const idxRaw = patch.index;

  if (idxRaw === undefined || idxRaw === null || idxRaw === "") {
    const existingImageIdx = findImageSectionIndex(out);
    if (existingImageIdx >= 0) {
      const existing = out[existingImageIdx];
      if (existing && typeof existing === "object" && !Array.isArray(existing)) {
        out[existingImageIdx] = { ...(existing as Record<string, unknown>), ...section };
      } else {
        out[existingImageIdx] = section;
      }
      return out;
    }
    const insertAt = defaultImageInsertIndex(out);
    out.splice(insertAt, 0, section);
    return out;
  }

  const idx = Math.max(0, Math.min(out.length, Number(idxRaw) || 0));
  const existing = out[idx];
  if (existing && typeof existing === "object" && !Array.isArray(existing)) {
    out[idx] = { ...(existing as Record<string, unknown>), ...section };
  } else {
    out.splice(idx, 0, section);
  }
  return out;
}

function isHeroClearValue(value: unknown): boolean {
  return value === null || value === "";
}

const HERO_CLEAR_KEYS = [
  "header_image",
  "headerImage",
  "hero_image",
  "heroImage",
  "image_url",
  "image",
  "header_media_url",
  "media_url",
] as const;

export function mergeTemplateFields(
  prior: TemplateFieldsRecord,
  patch: TemplateFieldsRecord,
): TemplateFieldsRecord {
  const base = isPlainObject(prior) ? { ...prior } : {};
  const incoming = isPlainObject(patch) ? { ...patch } : {};
  const sectionsPatch = incoming.sections_patch;
  delete incoming.sections_patch;

  const next: TemplateFieldsRecord = { ...base };
  const clearHero = HERO_CLEAR_KEYS.some(
    (key) => key in incoming && isHeroClearValue(incoming[key]),
  );
  if (clearHero) {
    for (const key of HERO_CLEAR_KEYS) {
      delete next[key];
    }
  }

  for (const [key, value] of Object.entries(incoming)) {
    if (value === undefined) continue;
    if (clearHero && (HERO_CLEAR_KEYS as readonly string[]).includes(key) && isHeroClearValue(value)) {
      continue;
    }
    if (key === "sections" && Array.isArray(value)) {
      next.sections = value;
      continue;
    }
    next[key] = value;
  }

  if (isPlainObject(sectionsPatch)) {
    const priorSections = Array.isArray(next.sections) ? [...next.sections] : [];
    next.sections = applySectionsPatch(priorSections, sectionsPatch);
  }

  return next;
}

function normText(value: unknown): string {
  return String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");
}

function sectionContentKey(section: Record<string, unknown>): string {
  const kind = sectionType(section) || "text";
  const content = normText(section.content);
  const label = normText(section.label);
  const items = Array.isArray(section.items)
    ? section.items.map((item) => normText(item)).join("|")
    : "";
  return `${kind}|${content}|${label}|${items}`;
}

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
    const kind = sectionType(row) || "text";
    const key = sectionContentKey(row);
    const isCopy = kind === "text" || kind === "headline";
    if (isCopy && key && key === prevKey) continue;
    out.push(row);
    prevKey = isCopy ? key : "";
  }
  return out;
}

/** Match backend send renderer — sections-only when designed email. */
export function isHttpImageUrl(value: unknown): boolean {
  const url = String(value ?? "").trim();
  if (!url || /\{\{|\}\}/.test(url) || /\s/.test(url) || /campaign_url/i.test(url)) {
    return false;
  }
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

function resolveFlatHeroUrl(fields: TemplateFieldsRecord): string {
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

function defaultHeroInsertIndex(sections: Record<string, unknown>[]): number {
  const headlineIdx = sections.findIndex((s) => sectionType(s) === "headline");
  return headlineIdx >= 0 ? headlineIdx + 1 : 0;
}

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
      out.push({ ...row, type: "image", url: imgUrl, content: imgUrl });
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

  const dictRows = out.filter(
    (r): r is Record<string, unknown> =>
      Boolean(r && typeof r === "object" && !Array.isArray(r)),
  );
  const hasImage = dictRows.some(
    (r) => sectionType(r) === "image" && sectionImageUrl(r),
  );
  if (hero && !heroPlaced && !hasImage) {
    out.splice(defaultHeroInsertIndex(dictRows), 0, {
      type: "image",
      url: hero,
      content: hero,
    });
  }

  return out;
}

export function canonicalizeEmailTemplateFields(
  fields: TemplateFieldsRecord,
): TemplateFieldsRecord {
  const out: TemplateFieldsRecord = { ...fields };
  const sections = Array.isArray(out.sections) ? [...out.sections] : [];
  if (sections.length > 0) {
    const heroHintRaw = resolveFlatHeroUrl(out);
    const heroHint = heroHintRaw ? absolutizeMediaUrl(heroHintRaw) : "";
    out.sections = normalizeEmailHeroSections(
      dedupeEmailSections(sections),
      heroHint,
    ).map((raw) => {
      if (!raw || typeof raw !== "object" || Array.isArray(raw)) return raw;
      const row = { ...(raw as Record<string, unknown>) };
      const img = sectionImageUrl(row);
      if (img) {
        const pub = absolutizeMediaUrl(img);
        row.url = pub;
        if (isHttpImageUrl(String(row.content ?? "").trim()) || sectionType(row) === "image") {
          row.content = pub;
        }
      }
      return row;
    });
    let hero = resolveFlatHeroUrl(out);
    if (!hero && Array.isArray(out.sections)) {
      for (const raw of out.sections) {
        if (!raw || typeof raw !== "object" || Array.isArray(raw)) continue;
        const img = sectionImageUrl(raw as Record<string, unknown>);
        if (img) {
          hero = img;
          break;
        }
      }
    }
    if (hero) {
      const pub = absolutizeMediaUrl(hero);
      out.header_image = pub;
      out.image_url = pub;
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
    out.greeting = "";
    out.paragraphs = [];
    out.body = "";
    out.signoff = "";
    out.footer = "";
    delete out.blocks;
    return out;
  }
  for (const key of [
    "header_image",
    "image_url",
    "image",
    "header_media_url",
    "media_url",
  ]) {
    const v = String(out[key] ?? "").trim();
    if (v) out[key] = absolutizeMediaUrl(v);
  }
  const greeting = String(out.greeting ?? "").trim();
  const paragraphs = Array.isArray(out.paragraphs)
    ? out.paragraphs.map((p) => String(p ?? "").trim()).filter(Boolean)
    : [];
  if (greeting && paragraphs.length && normText(paragraphs[0]) === normText(greeting)) {
    out.paragraphs = paragraphs.slice(1);
  }
  return out;
}

/** Canonical hero URL — one source of truth for preview rendering. */
export function canonicalTemplateHeroUrl(
  fields: TemplateFieldsRecord | null | undefined,
): string {
  if (!fields || typeof fields !== "object") return "";
  const flat = String(
    fields.header_image ||
      fields.header_media_url ||
      fields.image_url ||
      fields.image ||
      fields.media_url ||
      "",
  ).trim();
  if (isHttpImageUrl(flat)) return absolutizeMediaUrl(flat);
  const sections = Array.isArray(fields.sections) ? fields.sections : [];
  for (const row of sections) {
    if (!row || typeof row !== "object" || Array.isArray(row)) continue;
    if (sectionType(row) !== "image") continue;
    const src = String(
      (row as Record<string, unknown>).url ||
        (row as Record<string, unknown>).content ||
        "",
    ).trim();
    if (isHttpImageUrl(src)) return absolutizeMediaUrl(src);
  }
  return "";
}
