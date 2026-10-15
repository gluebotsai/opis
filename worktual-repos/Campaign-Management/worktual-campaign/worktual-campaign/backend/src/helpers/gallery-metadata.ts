/** Template Gallery metadata helpers — shared by library DAO + worker. */

import { isCurrentGalleryTemplateKey } from "./gallery-template-specs.js";

export type GalleryTemplateStatus = "active" | "locked" | "hidden";

export type GalleryTemplateMetadata = {
  galleryStatus?: GalleryTemplateStatus;
  campaignIdeaId?: string;
  campaignIdeaKey?: string;
  campaignIdeaTitle?: string;
  templateType?: string;
  hasImage?: boolean;
  variantIndex?: number;
  generationBatchId?: string;
  generationVersion?: string;
  legacyStaticSeed?: boolean;
  [key: string]: unknown;
};

export function parseGalleryMetadata(raw: unknown): GalleryTemplateMetadata {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  return raw as GalleryTemplateMetadata;
}

export function galleryStatusOf(metadata: unknown): GalleryTemplateStatus {
  const status = parseGalleryMetadata(metadata).galleryStatus;
  if (status === "locked" || status === "hidden" || status === "active") {
    return status;
  }
  return "active";
}

export function isLegacyStaticLibraryRow(input: {
  source: string;
  metadata: unknown;
}): boolean {
  if (input.source === "system") return true;
  const meta = parseGalleryMetadata(input.metadata);
  return meta.legacyStaticSeed === true || meta.galleryStatus === "hidden";
}

export function shouldShowInGalleryList(input: {
  source: string;
  metadata: unknown;
  seedSlug?: string | null;
  includeLocked?: boolean;
  includeHidden?: boolean;
}): boolean {
  const status = galleryStatusOf(input.metadata);
  if (input.source === "system" || status === "hidden") {
    return input.includeHidden === true;
  }
  if (input.source === "generated") {
    const key = String(input.seedSlug || "").trim();
    const meta = parseGalleryMetadata(input.metadata);
    if (
      !key ||
      !isCurrentGalleryTemplateKey(key) ||
      !String(meta.campaignIdeaKey || "").trim()
    ) {
      return input.includeHidden === true;
    }
  }
  if (status === "locked") return input.includeLocked === true;
  return true;
}

export const GALLERY_GENERATION_VERSION = "gallery-v1";
export const GALLERY_MIN_IDEAS = 10;
