import axios from "axios";
import { api } from "@/services/api";

type ApiEnvelope<T> = {
  statusCode?: number;
  message?: string;
} & T;

const MAX_BYTES = 3 * 1024 * 1024;

const PRODUCTION_MEDIA_ORIGIN = "https://rebuild-campaign-api.worktual.com";

/** Configured public media origin (rebuild in prod; LAN base when using dev-lan). */
const CONFIGURED_MEDIA_ORIGIN =
  String(
    (typeof import.meta !== "undefined" &&
      (import.meta as ImportMeta & { env?: { VITE_MEDIA_PUBLIC_BASE?: string } })
        .env?.VITE_MEDIA_PUBLIC_BASE) ||
      "",
  )
    .trim()
    .replace(/\/$/, "") || PRODUCTION_MEDIA_ORIGIN;

function mediaDevLocalPublish(): boolean {
  const flag = String(
    (typeof import.meta !== "undefined" &&
      (import.meta as ImportMeta & {
        env?: { VITE_MEDIA_ALLOW_LOCAL_PUBLISH?: string };
      }).env?.VITE_MEDIA_ALLOW_LOCAL_PUBLISH) ||
      "",
  )
    .trim()
    .toLowerCase();
  if (["0", "false", "no"].includes(flag)) return false;
  if (["1", "true", "yes"].includes(flag)) return true;
  try {
    if (typeof import.meta !== "undefined" && import.meta.env?.DEV) return true;
  } catch {
    /* fall through */
  }
  try {
    return isLoopbackOrLanHost(new URL(CONFIGURED_MEDIA_ORIGIN).hostname);
  } catch {
    return false;
  }
}

function fileToDataUrl(file: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    if (file.size > MAX_BYTES) {
      reject(new Error("Image must be under 3 MB"));
      return;
    }
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ""));
    reader.onerror = () => reject(new Error("Could not read that file"));
    reader.readAsDataURL(file);
  });
}

function isLoopbackOrLanHost(host: string): boolean {
  const h = String(host || "")
    .trim()
    .toLowerCase();
  if (!h) return false;
  if (
    h === "localhost" ||
    h === "127.0.0.1" ||
    h === "0.0.0.0" ||
    h === "::1"
  ) {
    return true;
  }
  if (h.startsWith("192.168.") || h.startsWith("10.")) return true;
  if (h.startsWith("172.")) {
    const second = Number(h.split(".")[1] || "");
    return second >= 16 && second <= 31;
  }
  return false;
}

/**
 * Absolute media URL for template fields.
 * Dev local publish: keep same-origin `/api/media/…` or LAN base — do not stamp rebuild.
 */
export function absolutizeMediaUrl(
  url: string,
  opts?: { localDev?: boolean },
): string {
  const raw = String(url || "").trim();
  if (!raw) return "";
  const localDev = opts?.localDev ?? mediaDevLocalPublish();
  if (/^https?:\/\//i.test(raw)) {
    try {
      const parsed = new URL(raw);
      const path = `${parsed.pathname || ""}${parsed.search || ""}`;
      if (/^\/api\/media\//i.test(parsed.pathname) || /^\/media\//i.test(parsed.pathname)) {
        if (localDev) {
          // Keep LAN/loopback so chat + Vite proxy can load local /api/media bytes.
          if (isLoopbackOrLanHost(parsed.hostname)) {
            return `${parsed.origin}${parsed.pathname}${parsed.search || ""}`;
          }
          return path;
        }
        if (isLoopbackOrLanHost(parsed.hostname)) {
          return `${PRODUCTION_MEDIA_ORIGIN}${parsed.pathname}${parsed.search || ""}`;
        }
      }
      return raw;
    } catch {
      return raw;
    }
  }
  if (raw.startsWith("/")) {
    if (localDev && (/^\/api\/media\//i.test(raw) || /^\/media\//i.test(raw))) {
      return raw;
    }
    return `${localDev ? CONFIGURED_MEDIA_ORIGIN : PRODUCTION_MEDIA_ORIGIN}${raw}`;
  }
  return raw;
}

/** Upload a local image (File or Blob); returns public URL + media_id. Extension optional. */
export async function uploadTemplateImageAsset(
  file: Blob,
): Promise<{ url: string; media_id: string }> {
  const data_url = await fileToDataUrl(file);
  if (!data_url.startsWith("data:image/")) {
    throw new Error("Please choose a JPEG, PNG, GIF, or WebP image");
  }
  try {
    const { data } = await api.post<
      ApiEnvelope<{ url: string; media_id?: string }>
    >("/media/upload", { data_url }, { timeout: 60_000 });
    if (!data.url) throw new Error("Upload did not return an image URL");
    const media_id =
      String(data.media_id || "").trim() ||
      String(data.url).split("/").pop() ||
      "";
    return { url: absolutizeMediaUrl(data.url), media_id };
  } catch (err) {
    if (axios.isAxiosError(err)) {
      if (
        !err.response ||
        err.code === "ERR_NETWORK" ||
        err.code === "ECONNABORTED"
      ) {
        throw new Error(
          "Campaign backend is not running on :3001. Start it, then upload again.",
        );
      }
      const payload = err.response.data as { message?: string } | undefined;
      if (payload?.message?.trim()) throw new Error(payload.message.trim());
    }
    throw err instanceof Error ? err : new Error("Upload failed");
  }
}

/**
 * Finish a composer pending image: prefer warm-upload result, else upload the blob preview.
 * Avoids `new File(...)` (which breaks when Lucide's `File` icon is in scope).
 */
export async function resolvePendingChatImageUpload(opts: {
  imageUrl?: string;
  mediaId?: string;
  previewUrl?: string;
  filename?: string;
  /** In-flight warm-upload from pick time. */
  uploadPromise?: Promise<{ url: string; media_id: string }> | null;
}): Promise<{ url: string; media_id: string; filename: string }> {
  const filename = String(opts.filename || "image").trim() || "image";
  let url = String(opts.imageUrl || "").trim();
  let mediaId = String(opts.mediaId || "").trim();
  if (url) {
    return { url: absolutizeMediaUrl(url), media_id: mediaId, filename };
  }
  if (opts.uploadPromise) {
    try {
      const uploaded = await opts.uploadPromise;
      url = String(uploaded.url || "").trim();
      mediaId = String(uploaded.media_id || "").trim();
      if (url) return { url: absolutizeMediaUrl(url), media_id: mediaId, filename };
    } catch {
      /* fall through to blob re-upload */
    }
  }
  const preview = String(opts.previewUrl || "").trim();
  if (!preview) {
    throw new Error("Image upload failed");
  }
  const blob = await fetch(preview).then((r) => r.blob());
  const uploaded = await uploadTemplateImageAsset(blob);
  return {
    url: absolutizeMediaUrl(uploaded.url),
    media_id: uploaded.media_id,
    filename,
  };
}

/** Upload a local image; URL has no required file extension. */
export async function uploadTemplateImage(file: File): Promise<string> {
  const { url } = await uploadTemplateImageAsset(file);
  return url;
}
