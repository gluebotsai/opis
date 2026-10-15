/** Gallery hero image attach — top ideas only, template copy unchanged. */

import {
  GALLERY_EMAIL_HERO_IDEA_COUNT,
  galleryKeyForIdeaChannel,
  ideaQualifiesForGalleryHero,
  templateSpecsForIdea,
} from "./gallery-template-specs.js";

export { GALLERY_EMAIL_HERO_IDEA_COUNT, ideaQualifiesForGalleryHero };

/** Local / LAN URLs are not reachable from Gmail or other hosts — treat as missing hero. */
export function isLocalOnlyMediaUrl(url: string): boolean {
  const raw = String(url || "").trim();
  if (!raw) return false;
  try {
    if (/^https?:\/\//i.test(raw)) {
      const host = new URL(raw).hostname.toLowerCase();
      if (
        host === "127.0.0.1" ||
        host === "localhost" ||
        host === "0.0.0.0" ||
        host === "::1"
      ) {
        return true;
      }
      if (host.startsWith("192.168.") || host.startsWith("10.")) return true;
      if (host.startsWith("172.")) {
        const second = Number(host.split(".")[1] || "");
        return second >= 16 && second <= 31;
      }
      return false;
    }
  } catch {
    /* fall through */
  }
  return /127\.0\.0\.1|localhost|192\.168\.|10\.\d+\.|172\.(1[6-9]|2\d|3[0-1])\./i.test(
    raw,
  );
}

function isReachableMediaUrl(url: string): boolean {
  const raw = String(url || "").trim();
  return /^https?:\/\//i.test(raw) && !isLocalOnlyMediaUrl(raw);
}

export function heroUrlFromFields(fields: Record<string, unknown>): string {
  for (const key of ["header_image", "image_url", "header_media_url"]) {
    const url = String(fields[key] || "").trim();
    if (isReachableMediaUrl(url)) return url;
  }
  const sections = fields.sections;
  if (Array.isArray(sections)) {
    for (const row of sections) {
      if (!row || typeof row !== "object") continue;
      const kind = String((row as Record<string, unknown>).type || "").toLowerCase();
      if (kind !== "image") continue;
      const url = String(
        (row as Record<string, unknown>).url ||
          (row as Record<string, unknown>).content ||
          "",
      ).trim();
      if (isReachableMediaUrl(url)) return url;
    }
  }
  return "";
}

export function emailGalleryTemplateHasHero(row: {
  fields?: unknown;
  previewImage?: string | null;
  metadata?: unknown;
}): boolean {
  const meta =
    row.metadata && typeof row.metadata === "object" && !Array.isArray(row.metadata)
      ? (row.metadata as Record<string, unknown>)
      : null;
  const fields = asFields(row.fields);
  const fieldUrl = fields ? heroUrlFromFields(fields) : "";
  const preview = String(row.previewImage || "").trim();
  return isReachableMediaUrl(fieldUrl) || isReachableMediaUrl(preview);
}

function asFields(raw: unknown): Record<string, unknown> | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  return raw as Record<string, unknown>;
}

export function emailGalleryTemplateNeedsHeroAttach(row: {
  fields?: unknown;
  previewImage?: string | null;
  metadata?: unknown;
  primaryChannel?: string;
  seedSlug?: string | null;
  galleryKey?: string;
}): boolean {
  if (row.primaryChannel !== "email") return false;
  const fields = asFields(row.fields);
  if (!fields || !Array.isArray(fields.sections) || fields.sections.length === 0) {
    return false;
  }
  if (emailGalleryTemplateHasHero(row)) return false;
  return true;
}

export function webPushGalleryTemplateHasImage(row: {
  fields?: unknown;
  previewImage?: string | null;
  metadata?: unknown;
  preview?: unknown;
}): boolean {
  const meta =
    row.metadata && typeof row.metadata === "object" && !Array.isArray(row.metadata)
      ? (row.metadata as Record<string, unknown>)
      : null;
  const fields = asFields(row.fields);
  const fieldUrl = fields ? heroUrlFromFields(fields) : "";
  const preview = String(row.previewImage || "").trim();
  if (isReachableMediaUrl(fieldUrl) || isReachableMediaUrl(preview)) return true;
  if (meta?.galleryHeroAttached === true) return false;
  const prev =
    row.preview && typeof row.preview === "object" && !Array.isArray(row.preview)
      ? (row.preview as Record<string, unknown>)
      : null;
  return prev?.kind === "web_visual";
}

export function webPushGalleryTemplateNeedsImageSync(row: {
  fields?: unknown;
  previewImage?: string | null;
  metadata?: unknown;
  preview?: unknown;
  primaryChannel?: string;
}): boolean {
  if (row.primaryChannel !== "web_push") return false;
  const fields = asFields(row.fields);
  if (!fields || !String(fields.title || fields.body || "").trim()) return false;
  if (webPushGalleryTemplateHasImage(row)) return false;
  return true;
}

export type GalleryHeroAttachTarget = {
  kind: "email_attach";
  galleryKey: string;
  ideaKey: string;
  sortOrder: number;
  variantIndex: number;
};

export type GalleryWebPushImageSyncTarget = {
  kind: "web_push_sync";
  galleryKey: string;
  emailGalleryKey: string;
  ideaKey: string;
  sortOrder: number;
  variantIndex: number;
  emailImageUrl: string;
};

export type GalleryImageWorkTarget =
  | GalleryHeroAttachTarget
  | GalleryWebPushImageSyncTarget;

type GalleryRow = {
  primaryChannel?: string;
  fields?: unknown;
  previewImage?: string | null;
  metadata?: unknown;
  preview?: unknown;
  seedSlug?: string | null;
  galleryKey?: string;
};

export function heroAttachTargetsForOrg(
  ideas: Array<{ ideaKey: string; sortOrder: number }>,
  channels: string[],
  rowsByKey: Map<string, GalleryRow>,
): GalleryHeroAttachTarget[] {
  const targets: GalleryHeroAttachTarget[] = [];
  for (const idea of ideas) {
    if (!ideaQualifiesForGalleryHero(idea.sortOrder)) continue;
    const specs = templateSpecsForIdea(idea.ideaKey, idea.sortOrder, channels);
    const emailSpec = specs.find((s) => s.primary_channel === "email");
    if (!emailSpec) continue;
    const row = rowsByKey.get(emailSpec.gallery_key);
    if (!row) continue;
    if (
      !emailGalleryTemplateNeedsHeroAttach({
        ...row,
        primaryChannel: "email",
        seedSlug: emailSpec.gallery_key,
        galleryKey: emailSpec.gallery_key,
      })
    ) {
      continue;
    }
    targets.push({
      kind: "email_attach",
      galleryKey: emailSpec.gallery_key,
      ideaKey: idea.ideaKey,
      sortOrder: idea.sortOrder,
      variantIndex: emailSpec.variant_index,
    });
  }
  return targets;
}

export function webPushImageSyncTargetsForOrg(
  ideas: Array<{ ideaKey: string; sortOrder: number }>,
  channels: string[],
  rowsByKey: Map<string, GalleryRow>,
): GalleryWebPushImageSyncTarget[] {
  const targets: GalleryWebPushImageSyncTarget[] = [];
  for (const idea of ideas) {
    if (!ideaQualifiesForGalleryHero(idea.sortOrder)) continue;
    const specs = templateSpecsForIdea(idea.ideaKey, idea.sortOrder, channels);
    const emailSpec = specs.find((s) => s.primary_channel === "email");
    const webSpec = specs.find((s) => s.primary_channel === "web_push");
    if (!emailSpec || !webSpec) continue;
    const emailKey = emailSpec.gallery_key;
    const webKey = webSpec.gallery_key;
    const emailRow = rowsByKey.get(emailKey);
    const webRow = rowsByKey.get(webKey);
    if (!emailRow || !webRow) continue;
    if (!emailGalleryTemplateHasHero(emailRow)) continue;
    if (
      !webPushGalleryTemplateNeedsImageSync({
        ...webRow,
        primaryChannel: "web_push",
      })
    ) {
      continue;
    }
    const emailFields = asFields(emailRow.fields);
    const emailImageUrl =
      String(emailRow.previewImage || "").trim() ||
      (emailFields ? heroUrlFromFields(emailFields) : "");
    if (!isReachableMediaUrl(emailImageUrl)) continue;
    targets.push({
      kind: "web_push_sync",
      galleryKey: webKey,
      emailGalleryKey: emailKey,
      ideaKey: idea.ideaKey,
      sortOrder: idea.sortOrder,
      variantIndex: webSpec.variant_index,
      emailImageUrl,
    });
  }
  return targets;
}

export function galleryImageWorkTargetsForOrg(
  ideas: Array<{ ideaKey: string; sortOrder: number }>,
  channels: string[],
  rowsByKey: Map<string, GalleryRow>,
): GalleryImageWorkTarget[] {
  return [
    ...heroAttachTargetsForOrg(ideas, channels, rowsByKey),
    ...webPushImageSyncTargetsForOrg(ideas, channels, rowsByKey),
  ];
}

export function countEmailGalleryHeroAttachPending(
  ideas: Array<{ ideaKey: string; sortOrder: number }>,
  channels: string[],
  rowsByKey: Map<string, GalleryRow>,
): number {
  return heroAttachTargetsForOrg(ideas, channels, rowsByKey).length;
}

export function countWebPushGalleryImageSyncPending(
  ideas: Array<{ ideaKey: string; sortOrder: number }>,
  channels: string[],
  rowsByKey: Map<string, GalleryRow>,
): number {
  return webPushImageSyncTargetsForOrg(ideas, channels, rowsByKey).length;
}

export function countGalleryImageWorkPending(
  ideas: Array<{ ideaKey: string; sortOrder: number }>,
  channels: string[],
  rowsByKey: Map<string, GalleryRow>,
): number {
  return galleryImageWorkTargetsForOrg(ideas, channels, rowsByKey).length;
}
