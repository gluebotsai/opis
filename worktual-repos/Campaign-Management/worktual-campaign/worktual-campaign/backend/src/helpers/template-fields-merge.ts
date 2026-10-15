/** Deep-enough merge for template field PATCH — never wipe prior copy on partial updates. */

export type TemplateFields = Record<string, unknown>;

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function imageSectionFromPatch(patch: Record<string, unknown>): Record<string, unknown> {
  const url = String(patch.url ?? patch.content ?? "").trim();
  return {
    type: String(patch.type ?? "image").trim() || "image",
    url,
    content: String(patch.content ?? patch.url ?? url).trim(),
  };
}

function sectionType(section: unknown): string {
  if (!section || typeof section !== "object" || Array.isArray(section)) return "";
  return String((section as Record<string, unknown>).type ?? "").trim().toLowerCase();
}

function findImageSectionIndex(sections: unknown[]): number {
  return sections.findIndex((s) => sectionType(s) === "image");
}

function defaultImageInsertIndex(sections: unknown[]): number {
  const headlineIdx = sections.findIndex((s) => sectionType(s) === "headline");
  return headlineIdx >= 0 ? headlineIdx + 1 : 0;
}

/** Insert or update a section from a sections_patch payload. */
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

/**
 * Merge a partial fields patch into prior saved fields.
 * - Shallow merge for scalar keys (header_image, subject, etc.)
 * - sections_patch is applied to prior sections then removed from output
 * - Full sections array in patch replaces sections when explicitly sent
 */
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
  prior: TemplateFields,
  patch: TemplateFields,
): TemplateFields {
  const base = isPlainObject(prior) ? { ...prior } : {};
  const incoming = isPlainObject(patch) ? { ...patch } : {};
  const sectionsPatch = incoming.sections_patch;
  delete incoming.sections_patch;

  const next: TemplateFields = { ...base };
  const clearHero = HERO_CLEAR_KEYS.some(
    (key) => key in incoming && isHeroClearValue(incoming[key]),
  );
  if (clearHero) {
    for (const key of HERO_CLEAR_KEYS) {
      delete next[key];
    }
    if (incoming.header_media_handle === "" || incoming.header_media_handle === null) {
      delete next.header_media_handle;
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
