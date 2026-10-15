/** Detect gallery email rows that need regeneration (old design / missing fields). */

import { GALLERY_EMAIL_DESIGN_VERSION } from "./gallery-template-specs.js";

export function emailGalleryTemplateNeedsRegen(row: {
  fields?: unknown;
  metadata?: unknown;
  primaryChannel?: string;
}): boolean {
  if (row.primaryChannel !== "email") return false;
  const fields =
    row.fields && typeof row.fields === "object" && !Array.isArray(row.fields)
      ? (row.fields as Record<string, unknown>)
      : null;
  const meta =
    row.metadata && typeof row.metadata === "object" && !Array.isArray(row.metadata)
      ? (row.metadata as Record<string, unknown>)
      : null;
  if (!fields) return true;
  if (!Array.isArray(fields.sections) || fields.sections.length === 0) return true;
  if (!fields.pattern_id) return true;
  if (meta?.galleryEmailDesignVersion !== GALLERY_EMAIL_DESIGN_VERSION) return true;
  return false;
}

export function countEmailGalleryTemplatesNeedingRegen(
  rows: Array<{
    fields?: unknown;
    metadata?: unknown;
    primaryChannel?: string;
  }>,
): number {
  return rows.filter((row) => emailGalleryTemplateNeedsRegen(row)).length;
}
