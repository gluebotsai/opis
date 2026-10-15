/** Chat thumbnails — composer pending + sent bubbles (create + edit). */

export type ChatImageAttachment = {
  url: string;
  filename?: string;
};

export type ChatImageSource = {
  imageUrl?: string;
  imageFilename?: string;
  imageUrls?: ChatImageAttachment[];
  image_urls?: ChatImageAttachment[];
};

/** Same upload often appears as LAN + rebuild URLs — dedupe by media id, not full string. */
export function chatImageIdentityKey(url: string): string {
  const raw = String(url || "").trim();
  if (!raw) return "";
  if (raw.startsWith("blob:")) return raw;
  try {
    const path = /^https?:\/\//i.test(raw)
      ? new URL(raw).pathname
      : (raw.split("?")[0] || raw);
    const match = path.match(/\/(?:api\/)?media\/([^/?#]+)/i);
    if (match?.[1]) return `media:${match[1].toLowerCase()}`;
  } catch {
    /* fall through */
  }
  return raw;
}

function chatImageUrlScore(url: string): number {
  if (/^https?:\/\//i.test(url)) return 3;
  if (url.startsWith("/api/media/")) return 2;
  if (url.startsWith("blob:")) return 0;
  return 1;
}

function mergeChatImageAttachment(
  existing: ChatImageAttachment,
  incoming: ChatImageAttachment,
): ChatImageAttachment {
  const url = incoming.url;
  const filename =
    existing.filename || incoming.filename || undefined;
  const pickUrl =
    chatImageUrlScore(incoming.url) > chatImageUrlScore(existing.url)
      ? incoming.url
      : existing.url;
  return filename ? { url: pickUrl, filename } : { url: pickUrl };
}

/** Collapse duplicate attachments (same media id, different host/path prefix). */
export function dedupeChatMessageImages(
  images: ChatImageAttachment[],
): ChatImageAttachment[] {
  const out: ChatImageAttachment[] = [];
  const indexByKey = new Map<string, number>();
  for (const row of images) {
    const url = String(row?.url ?? "").trim();
    if (!url) continue;
    const key = chatImageIdentityKey(url);
    const filename = String(row?.filename ?? "").trim();
    const item: ChatImageAttachment = filename ? { url, filename } : { url };
    const idx = indexByKey.get(key);
    if (idx == null) {
      indexByKey.set(key, out.length);
      out.push(item);
      continue;
    }
    out[idx] = mergeChatImageAttachment(out[idx]!, item);
  }
  return out;
}

/** Create-campaign chat bubbles — dedupe after local + session merge. */
export function resolveCreateChatBubbleImages(
  source: ChatImageSource | null | undefined,
): ChatImageAttachment[] {
  return dedupeChatMessageImages(resolveChatMessageImages(source));
}

export function resolveChatMessageImages(
  source: ChatImageSource | null | undefined,
): ChatImageAttachment[] {
  if (!source) return [];
  const list = source.imageUrls ?? source.image_urls;
  if (Array.isArray(list) && list.length) {
    const out: ChatImageAttachment[] = [];
    for (const row of list) {
      const url = String(row?.url ?? "").trim();
      if (!url) continue;
      const filename = String(row?.filename ?? "").trim();
      out.push(filename ? { url, filename } : { url });
    }
    if (out.length) return out;
  }
  const single = String(source.imageUrl ?? "").trim();
  if (!single) return [];
  const filename = String(source.imageFilename ?? "").trim();
  return filename ? [{ url: single, filename }] : [{ url: single }];
}

export function chatImagesFromUploads(
  uploads: Array<{ image_url: string; filename?: string }>,
): ChatImageAttachment[] {
  return uploads
    .map((u) => ({
      url: String(u.image_url ?? "").trim(),
      filename: String(u.filename ?? "").trim() || undefined,
    }))
    .filter((u) => u.url);
}

export function chatImagesFromPending(
  items: Array<{ previewUrl?: string; imageUrl?: string; filename?: string }>,
): ChatImageAttachment[] {
  return items
    .map((item) => {
      const url =
        item.imageUrl?.trim() || item.previewUrl?.trim() || "";
      if (!url) return null;
      const filename = item.filename?.trim();
      return filename ? { url, filename } : { url };
    })
    .filter((x): x is ChatImageAttachment => Boolean(x));
}

/** Merge attachments; dedupe by media id when merging local + session URLs. */
export function unionChatMessageImages(
  ...groups: (ChatImageAttachment[] | undefined)[]
): ChatImageAttachment[] {
  const flat: ChatImageAttachment[] = [];
  for (const group of groups) {
    if (!group?.length) continue;
    for (const row of group) {
      const url = String(row?.url ?? "").trim();
      if (!url) continue;
      const filename = String(row?.filename ?? "").trim();
      flat.push(filename ? { url, filename } : { url });
    }
  }
  return dedupeChatMessageImages(flat);
}

export function chatImageUrlsEqual(
  a: ChatImageAttachment[],
  b: ChatImageAttachment[],
): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i += 1) {
    if (a[i]!.url !== b[i]!.url) return false;
  }
  return true;
}
