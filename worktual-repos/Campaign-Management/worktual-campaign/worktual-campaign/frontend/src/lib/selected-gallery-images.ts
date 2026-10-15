/**
 * Persist user-selected org gallery images for create-campaign handoff.
 */

import { packStorageKey } from "@/lib/industry-packs";

export type GalleryImagePick = {
  id: string;
  media_id: string;
  image_url: string;
  short_description?: string;
};

const STORAGE_KEY_BASE = "worktual.selectedGalleryImages.v1";

export type SelectedGalleryImage = {
  id: string;
  media_id: string;
  image_url: string;
  short_description: string;
};

function storageKey() {
  return packStorageKey(STORAGE_KEY_BASE);
}

function canUseStorage() {
  return typeof window !== "undefined" && typeof localStorage !== "undefined";
}

export function readSelectedGalleryImages(): SelectedGalleryImage[] {
  if (!canUseStorage()) return [];
  try {
    const raw = localStorage.getItem(storageKey());
    if (!raw) return [];
    const parsed = JSON.parse(raw) as SelectedGalleryImage[];
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (row) => row && typeof row.id === "string" && row.image_url,
    );
  } catch {
    return [];
  }
}

/** Alias for handoff helpers (matches `listSelectedTemplates` naming). */
export const listSelectedGalleryImages = readSelectedGalleryImages;

function writeSelectedGalleryImages(rows: SelectedGalleryImage[]): void {
  if (!canUseStorage()) return;
  localStorage.setItem(storageKey(), JSON.stringify(rows));
}

export function isGalleryImageSelected(id: string): boolean {
  return readSelectedGalleryImages().some((r) => r.id === id);
}

export function toggleSelectedGalleryImage(
  asset: GalleryImagePick,
): SelectedGalleryImage[] {
  const current = readSelectedGalleryImages();
  const idx = current.findIndex((r) => r.id === asset.id);
  if (idx >= 0) {
    const next = [...current.slice(0, idx), ...current.slice(idx + 1)];
    writeSelectedGalleryImages(next);
    return next;
  }
  const row: SelectedGalleryImage = {
    id: asset.id,
    media_id: asset.media_id,
    image_url: asset.image_url,
    short_description: asset.short_description || "",
  };
  const next = [...current, row];
  writeSelectedGalleryImages(next);
  return next;
}

export function deselectGalleryImage(id: string): SelectedGalleryImage[] {
  const next = readSelectedGalleryImages().filter((r) => r.id !== id);
  writeSelectedGalleryImages(next);
  return next;
}

export function clearSelectedGalleryImages(): void {
  writeSelectedGalleryImages([]);
}

export function buildSelectedGalleryImagesPayload(
  rows: SelectedGalleryImage[] = readSelectedGalleryImages(),
) {
  return rows.map((r) => ({
    id: r.id,
    media_id: r.media_id,
    image_url: r.image_url,
    short_description: r.short_description,
  }));
}

export function buildGalleryImagesAcknowledgeSnippet(
  rows: SelectedGalleryImage[] = readSelectedGalleryImages(),
): string {
  if (rows.length === 0) return "";
  const labels = rows.map(
    (r) =>
      `“${(r.short_description || "Gallery image").slice(0, 80)}”`,
  );
  if (rows.length === 1) {
    return `I’ll use your selected gallery image ${labels[0]} where visuals fit this campaign.`;
  }
  return `I’ll use your ${rows.length} selected gallery images (${labels.join(", ")}) where visuals fit this campaign.`;
}
