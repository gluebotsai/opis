/** Template Gallery — one template per idea per ready channel (10 per channel). */

export const GALLERY_TEMPLATES_PER_CHANNEL = 10;
export const GALLERY_TEMPLATES_WITH_IMAGE = 5;
/** Top N campaign ideas (by sort order) receive hero images — copy unchanged. */
export const GALLERY_EMAIL_HERO_IDEA_COUNT = 5;
/** Phase 1: email + web push gallery (whatsapp/app_push later). */
export const GALLERY_EMAIL_ONLY_PHASE = true;
export const GALLERY_PHASE_CHANNELS = ["email", "web_push"] as const;
export const GALLERY_EMAIL_DESIGN_VERSION = "gallery-email-v2";

export type GalleryTemplateSpec = {
  gallery_key: string;
  channel: string;
  primary_channel: string;
  has_image: boolean;
  variant_index: number;
};

export function agentChannelForGallery(ch: string): string {
  if (ch === "web_push") return "web";
  if (ch === "app_push") return "push";
  return ch;
}

/** Ideas 0–4 get hero images once templates exist (attach-only, no regen). */
export function ideaSortOrderHasImage(sortOrder: number): boolean {
  return sortOrder < GALLERY_EMAIL_HERO_IDEA_COUNT;
}

export function ideaQualifiesForGalleryHero(sortOrder: number): boolean {
  return ideaSortOrderHasImage(sortOrder);
}

export function activeGalleryChannels(channels: string[]): string[] {
  if (!GALLERY_EMAIL_ONLY_PHASE) return channels;
  const allowed = new Set<string>(GALLERY_PHASE_CHANNELS);
  return channels.filter((ch) => allowed.has(ch));
}

export function galleryKeyForIdeaChannel(
  ideaKey: string,
  channel: string,
): string {
  return `${ideaKey}:${channel}:txt:01`;
}

export function templateSpecsForIdea(
  ideaKey: string,
  sortOrder: number,
  channels: string[],
): GalleryTemplateSpec[] {
  const active = activeGalleryChannels(channels);
  const ideaHasImage = ideaSortOrderHasImage(sortOrder);
  return active.map((ch) => {
    const hasImage = ch === "web_push" && ideaHasImage;
    return {
      gallery_key: `${ideaKey}:${ch}:${hasImage ? "img" : "txt"}:01`,
      channel: agentChannelForGallery(ch),
      primary_channel: ch,
      has_image: hasImage,
      variant_index: sortOrder + 1,
    };
  });
}

export function galleryKeysForIdea(
  ideaKey: string,
  sortOrder: number,
  channels: string[],
): string[] {
  return templateSpecsForIdea(ideaKey, sortOrder, channels).map(
    (s) => s.gallery_key,
  );
}

export function expectedGalleryTemplateCount(channels: string[]): number {
  return activeGalleryChannels(channels).length * GALLERY_TEMPLATES_PER_CHANNEL;
}

/** Current spec: one template per idea per channel (`idea:email:img:01`). */
export function isCurrentGalleryTemplateKey(key: string): boolean {
  return /^[^:]+:(email|whatsapp|web_push|app_push):(img|txt):01$/.test(
    String(key || "").trim(),
  );
}

export function ideaNeedsHeroImage(sortOrder: number): boolean {
  return ideaSortOrderHasImage(sortOrder);
}

export function countMissingTemplateSpecs(
  ideas: Array<{ ideaKey: string; sortOrder: number }>,
  channels: string[],
  existingKeys: Set<string>,
): number {
  let n = 0;
  for (const idea of ideas) {
    for (const key of galleryKeysForIdea(
      idea.ideaKey,
      idea.sortOrder,
      channels,
    )) {
      if (!existingKeys.has(key)) n += 1;
    }
  }
  return n;
}
