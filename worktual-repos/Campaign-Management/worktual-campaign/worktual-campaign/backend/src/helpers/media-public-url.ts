import fs from "node:fs/promises";
import path from "node:path";
import type { FastifyRequest } from "fastify";
import { env } from "../config/env.js";

const REBUILD_MEDIA_ORIGIN = "https://rebuild-campaign-api.worktual.com";
const MEDIA_ID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function mediaAllowLocalPublish(): boolean {
  return Boolean(env.media?.allowLocalPublish);
}

function configuredApiPublicOrigin(): string | null {
  const raw = String(env.apiPublicUrl || "")
    .trim()
    .replace(/\/$/, "");
  if (!raw) return null;
  try {
    const u = new URL(raw.endsWith("/api") ? raw.slice(0, -4) : raw);
    return `${u.protocol}//${u.host}`;
  } catch {
    return null;
  }
}

export function isLoopbackOrLanHost(host: string): boolean {
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
 * Where LAN/dev backends forward uploads so email + rebuild GET /api/media work.
 * Defaults to rebuild when API_PUBLIC_URL is LAN (dev-lan).
 */
export function mediaPublicUploadOrigin(): string {
  const explicit = String(process.env.MEDIA_PUBLIC_UPLOAD_ORIGIN ?? "")
    .trim()
    .replace(/\/$/, "");
  if (explicit) {
    try {
      const u = new URL(explicit.endsWith("/api") ? explicit.slice(0, -4) : explicit);
      return `${u.protocol}//${u.host}`;
    } catch {
      /* fall through */
    }
  }
  const configured = configuredApiPublicOrigin();
  if (configured) {
    try {
      const host = new URL(configured).hostname;
      if (isLoopbackOrLanHost(host)) {
        return REBUILD_MEDIA_ORIGIN;
      }
    } catch {
      /* fall through */
    }
  }
  return publicMediaOrigin();
}

function localUploadsDir(): string {
  return path.join(process.cwd(), "uploads");
}

export function extractCampaignMediaId(url: string): string {
  const raw = String(url || "").trim();
  let segment = "";
  if (raw.startsWith("/api/media/") || raw.startsWith("/media/")) {
    segment = raw.split("/").filter(Boolean).pop() || "";
  } else {
    try {
      segment = new URL(raw).pathname.split("/").filter(Boolean).pop() || "";
    } catch {
      segment = "";
    }
  }
  return MEDIA_ID_RE.test(segment) ? segment : "";
}

async function localMediaFileExists(mediaId: string): Promise<boolean> {
  if (!MEDIA_ID_RE.test(mediaId)) return false;
  try {
    await fs.access(path.join(localUploadsDir(), mediaId));
    return true;
  } catch {
    return false;
  }
}

/** Public origin for email + any device (never LAN/loopback unless dev local publish). */
export function publicMediaOrigin(): string {
  const configured = configuredApiPublicOrigin();
  if (configured) {
    try {
      const host = new URL(configured).hostname;
      if (!isLoopbackOrLanHost(host)) {
        return configured;
      }
      if (mediaAllowLocalPublish()) {
        return configured;
      }
    } catch {
      /* fall through */
    }
  }
  return REBUILD_MEDIA_ORIGIN;
}

/**
 * Normalize media URLs for template fields + outbound email.
 * Relative / LAN / loopback `/api/media/{id}` → rebuild absolute URL.
 */
/** Absolute URL after a local dev upload (LAN Host when API_PUBLIC_URL is still localhost). */
export function resolveLocalMediaAbsoluteUrl(
  request: FastifyRequest,
  relPath: string,
): string {
  const rel = relPath.startsWith("/") ? relPath : `/${relPath}`;
  if (mediaAllowLocalPublish()) {
    const configured = configuredApiPublicOrigin();
    if (configured) {
      try {
        const cfgHost = new URL(configured).hostname;
        if (isLoopbackOrLanHost(cfgHost)) {
          return `${configured}${rel}`;
        }
      } catch {
        /* fall through */
      }
    }
    const hostHeader = String(request.headers.host || "").trim();
    const hostOnly = hostHeader.split(":")[0]?.toLowerCase() || "";
    if (hostHeader && isLoopbackOrLanHost(hostOnly)) {
      const xfProto = String(request.headers["x-forwarded-proto"] || "")
        .split(",")[0]
        ?.trim();
      const proto = xfProto || "http";
      return `${proto}://${hostHeader}${rel}`;
    }
  }
  return publicizeMediaUrl(rel);
}

export function publicizeMediaUrl(url: string): string {
  const raw = String(url || "").trim();
  if (!raw) return "";
  const origin = publicMediaOrigin();
  try {
    if (raw.startsWith("/api/media/") || raw.startsWith("/media/")) {
      return `${origin}${raw.startsWith("/") ? raw : `/${raw}`}`;
    }
    if (/^https?:\/\//i.test(raw)) {
      const parsed = new URL(raw);
      const path = parsed.pathname || "";
      if (path.startsWith("/api/media/") || path.startsWith("/media/")) {
        if (isLoopbackOrLanHost(parsed.hostname)) {
          return `${origin}${path}`;
        }
        // Already absolute public media — keep host as-is.
        return `${parsed.protocol}//${parsed.host}${path}${parsed.search || ""}`;
      }
    }
  } catch {
    /* keep raw */
  }
  return raw;
}

function isCampaignTrackUrl(url: string): boolean {
  const u = url.toLowerCase();
  return (
    u.includes("/track/open/") ||
    u.includes("/track/click/") ||
    u.includes("/track/unsubscribe/") ||
    u.includes("/unsubscribe")
  );
}

function rewriteMediaInQuotedUrl(raw: string): string {
  const t = String(raw || "").trim();
  if (!t || t.startsWith("{{") || t.startsWith("cid:")) return t;
  if (t.startsWith("/api/media/") || t.startsWith("/media/")) {
    return publicizeMediaUrl(t);
  }
  if (/^https?:\/\//i.test(t)) {
    try {
      const parsed = new URL(t);
      const path = parsed.pathname || "";
      if (path.startsWith("/api/media/") || path.startsWith("/media/")) {
        return publicizeMediaUrl(t);
      }
      if (isLoopbackOrLanHost(parsed.hostname)) {
        return publicizeMediaUrl(t);
      }
    } catch {
      return t;
    }
  }
  return t;
}

/** Rewrite img src / CSS url() campaign media hosts so Gmail never sees localhost. */
export function publicizeHtmlMediaUrls(html: string): string {
  let out = String(html || "");
  if (!out) return out;
  out = out.replace(
    /(<img\b[^>]*?\bsrc\s*=\s*)(["'])([^"']+)\2/gi,
    (_m, prefix: string, q: string, url: string) =>
      `${prefix}${q}${rewriteMediaInQuotedUrl(url)}${q}`,
  );
  out = out.replace(/url\(\s*(['"]?)([^)'"]+)\1\s*\)/gi, (_m, q: string, url: string) => {
    const next = rewriteMediaInQuotedUrl(url.trim());
    const quote = q || "";
    return `url(${quote}${next}${quote})`;
  });
  return out;
}

export function collectHtmlImageUrls(html: string): string[] {
  const found: string[] = [];
  const re = /<img\b[^>]*\bsrc\s*=\s*["']([^"']+)["']/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html))) {
    const u = String(m[1] || "").trim();
    if (u) found.push(u);
  }
  return found;
}

export function isCampaignMediaPath(url: string): boolean {
  const t = String(url || "").trim();
  if (t.startsWith("/api/media/") || t.startsWith("/media/")) return true;
  try {
    const path = new URL(t).pathname || "";
    return path.startsWith("/api/media/") || path.startsWith("/media/");
  } catch {
    return t.includes("/api/media/") || t.includes("/media/");
  }
}

/**
 * Fail closed before SMTP: no LAN/loopback image hosts, and /api/media
 * URLs must return 200 from the public origin (not a rewritten 404).
 */
export async function assertOutboundEmailImagesPublic(
  html: string,
  organizationId = "",
): Promise<void> {
  const urls = collectHtmlImageUrls(html);
  const seen = new Set<string>();
  for (const raw of urls) {
    if (!raw || raw.startsWith("{{") || raw.startsWith("cid:")) continue;
    if (isCampaignTrackUrl(raw)) continue;
    let publicUrl = rewriteMediaInQuotedUrl(raw);
    if (isCampaignMediaPath(publicUrl)) {
      publicUrl = await resolveDeliveryMediaUrl(publicUrl, organizationId);
    }
    if (seen.has(publicUrl)) continue;
    seen.add(publicUrl);

    try {
      const parsed = new URL(publicUrl);
      if (isLoopbackOrLanHost(parsed.hostname)) {
        if (!mediaAllowLocalPublish()) {
          throw new Error(
            `Email image still points at a local host (${parsed.hostname}). Re-upload the image and regenerate before send.`,
          );
        }
        const mediaId = extractCampaignMediaId(publicUrl);
        if (mediaId && (await localMediaFileExists(mediaId))) {
          try {
            const res = await fetch(publicUrl, {
              method: "GET",
              redirect: "follow",
              signal: AbortSignal.timeout(12_000),
              headers: { Accept: "image/*,*/*" },
            });
            if (res.ok) continue;
          } catch {
            /* fall through */
          }
        }
        throw new Error(
          `Email image still points at a local host (${parsed.hostname}). Re-upload the image and regenerate before send.`,
        );
      }
    } catch (err) {
      if (err instanceof Error && err.message.startsWith("Email image")) {
        throw err;
      }
      if (!/^https?:\/\//i.test(publicUrl)) {
        if (isCampaignMediaPath(raw)) {
          throw new Error(
            "Email image uses a relative media path that could not be published.",
          );
        }
        continue;
      }
    }

    if (!isCampaignMediaPath(publicUrl)) continue;

    let res: Response;
    try {
      res = await fetch(publicUrl, {
        method: "GET",
        redirect: "follow",
        signal: AbortSignal.timeout(12_000),
        headers: { Accept: "image/*,*/*" },
      });
    } catch (err) {
      throw new Error(
        `Could not reach email image ${publicUrl}: ${
          err instanceof Error ? err.message : "network error"
        }`,
      );
    }
    if (!res.ok) {
      const mediaId = extractCampaignMediaId(publicUrl);
      if (mediaId && (await localMediaFileExists(mediaId))) {
        const localOrigin = configuredApiPublicOrigin();
        if (localOrigin) {
          try {
            const localGet = await fetch(`${localOrigin}/api/media/${mediaId}`, {
              method: "GET",
              redirect: "follow",
              signal: AbortSignal.timeout(12_000),
              headers: { Accept: "image/*,*/*" },
            });
            if (localGet.ok) continue;
          } catch {
            /* fall through */
          }
        }
        if (mediaAllowLocalPublish()) continue;
      }
      throw new Error(
        `Email image is not public (${res.status}): ${publicUrl}. Re-upload the hero so it is stored on the public media host.`,
      );
    }
  }
}

async function resolveDeliveryMediaUrl(
  url: string,
  organizationId: string,
): Promise<string> {
  const rewritten = rewriteMediaInQuotedUrl(url);
  const mediaId = extractCampaignMediaId(rewritten);
  if (!mediaId) return rewritten;
  if (/^https?:\/\//i.test(rewritten)) {
    try {
      const res = await fetch(rewritten, {
        method: "GET",
        redirect: "follow",
        signal: AbortSignal.timeout(8_000),
        headers: { Accept: "image/*,*/*" },
      });
      if (res.ok) return rewritten;
    } catch {
      /* publish local → rebuild below */
    }
  }
  if (organizationId) {
    const { publishLocalMediaIdToPublicRemote } = await import(
      "./media-remote-publish.js"
    );
    const published = await publishLocalMediaIdToPublicRemote(
      mediaId,
      organizationId,
    );
    if (published) return published;
  }
  if (!(await localMediaFileExists(mediaId))) return rewritten;
  const localOrigin = configuredApiPublicOrigin();
  if (localOrigin && mediaAllowLocalPublish()) {
    return `${localOrigin}/api/media/${mediaId}`;
  }
  return rewritten;
}

/** Prefer rebuild; auto-publish local uploads before send when needed. */
export async function rewriteEmailHtmlMediaForDelivery(
  html: string,
  organizationId = "",
): Promise<string> {
  let out = String(html || "");
  if (!out) return out;
  const matches = [...out.matchAll(/(<img\b[^>]*?\bsrc\s*=\s*)(["'])([^"']+)\2/gi)];
  for (const m of matches) {
    const full = m[0]!;
    const prefix = m[1]!;
    const q = m[2]!;
    const src = m[3]!;
    const next = await resolveDeliveryMediaUrl(src, organizationId);
    if (next !== src) {
      out = out.replace(full, `${prefix}${q}${next}${q}`);
    }
  }
  return out;
}

/** Rewrite header_image / image sections in template fields to public media URLs. */
export function publicizeTemplateImageFields(
  fields: Record<string, unknown>,
): Record<string, unknown> {
  const out: Record<string, unknown> = { ...(fields || {}) };
  for (const key of [
    "header_image",
    "image_url",
    "image",
    "header_media_url",
    "media_url",
    "headerImage",
    "hero_image",
    "heroImage",
  ]) {
    const v = String(out[key] ?? "").trim();
    if (v) out[key] = publicizeMediaUrl(v);
  }
  if (Array.isArray(out.sections)) {
    out.sections = out.sections.map((raw) => {
      if (!raw || typeof raw !== "object" || Array.isArray(raw)) return raw;
      const row = { ...(raw as Record<string, unknown>) };
      const kind = String(row.type ?? "")
        .trim()
        .toLowerCase();
      const url = String(row.url ?? "").trim();
      const content = String(row.content ?? "").trim();
      if (kind === "image" || /^https?:\/\//i.test(url) || /^https?:\/\//i.test(content)) {
        if (url) row.url = publicizeMediaUrl(url);
        if (content && (/^https?:\/\//i.test(content) || content.startsWith("/api/media/") || content.startsWith("/media/"))) {
          row.content = publicizeMediaUrl(content);
        }
      }
      return row;
    });
  }
  const compiled = String(out.compiled_html ?? "").trim();
  if (compiled) out.compiled_html = publicizeHtmlMediaUrls(compiled);
  const html = String(out.html ?? "").trim();
  if (html) out.html = publicizeHtmlMediaUrls(html);
  return out;
}
