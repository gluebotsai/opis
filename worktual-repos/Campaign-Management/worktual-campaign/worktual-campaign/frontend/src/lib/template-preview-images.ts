/**
 * B2B hero photos for template library cards (few shared assets).
 * Paths under frontend/public/template-previews/b2b/.
 */

const B2B = "/template-previews/b2b";

/** Four shared heroes — seeds map visualKey → one of these. */
export const B2B_PREVIEW_BY_VISUAL_KEY: Record<string, string> = {
  launch: `${B2B}/email-product-launch.png`,
  webinar: `${B2B}/email-webinar.png`,
  renewal: `${B2B}/email-case-study.png`,
  handshake: `${B2B}/handshake.jpg`,
  // Fallbacks for non-hero channels / older keys
  dashboard: `${B2B}/email-product-launch.png`,
  boardroom: `${B2B}/handshake.jpg`,
  growth: `${B2B}/email-case-study.png`,
  calendar: `${B2B}/email-webinar.png`,
  offer: `${B2B}/email-product-launch.png`,
  announce: `${B2B}/email-product-launch.png`,
  checklist: `${B2B}/email-case-study.png`,
  pipeline: `${B2B}/email-case-study.png`,
  demo: `${B2B}/email-product-launch.png`,
};

/** Kinds that show a hero / media block (not text-only chrome). */
const MEDIA_KINDS = new Set(["email_hero", "wa_media", "web_visual"]);

function isLoopbackOrLanHost(host: string): boolean {
  const h = String(host || "").trim().toLowerCase();
  if (!h) return false;
  if (h === "localhost" || h === "127.0.0.1" || h === "0.0.0.0" || h === "::1") {
    return true;
  }
  if (h.startsWith("192.168.") || h.startsWith("10.")) return true;
  if (h.startsWith("172.")) {
    const second = Number(h.split(".")[1]);
    return Number.isFinite(second) && second >= 16 && second <= 31;
  }
  return false;
}

/** Rewrite media URLs to same-origin paths so the SPA (Vite proxy) can load them. */
export function normalizeTemplateMediaUrl(
  url: string | null | undefined,
): string | null {
  const raw = String(url || "").trim();
  if (!raw) return null;
  if (raw.startsWith("blob:") || raw.startsWith("data:")) return raw;
  if (raw.startsWith("/")) return raw;
  try {
    if (/^https?:\/\//i.test(raw)) {
      const parsed = new URL(raw);
      const path = `${parsed.pathname}${parsed.search}`;
      const host = parsed.hostname.toLowerCase();
      // Public https media must stay absolute — srcDoc iframes cannot load /api/media.
      if (/^\/api\/media\//i.test(parsed.pathname)) {
        if (isLoopbackOrLanHost(host)) return path;
        return raw;
      }
      if (isLoopbackOrLanHost(host)) {
        return path;
      }
      return raw;
    }
  } catch {
    /* fall through */
  }
  return raw;
}

/** Rewrite img/css media in compiled HTML so Live template iframe loads via Vite proxy. */
export function rewriteHtmlMediaUrlsForPreview(html: string): string {
  let out = String(html || "");
  if (!out) return out;
  out = out.replace(
    /(<img\b[^>]*?\bsrc\s*=\s*)(["'])([^"']+)\2/gi,
    (_m, prefix: string, q: string, url: string) => {
      const next = normalizeTemplateMediaUrl(url) || url;
      return `${prefix}${q}${next}${q}`;
    },
  );
  out = out.replace(
    /url\(\s*(['"]?)([^)'"]+)\1\s*\)/gi,
    (_m, q: string, url: string) => {
      const trimmed = url.trim();
      const next = normalizeTemplateMediaUrl(trimmed) || trimmed;
      const quote = q || "";
      return `url(${quote}${next}${quote})`;
    },
  );
  return out;
}

/**
 * srcDoc iframes resolve relative /api/media against about:srcdoc (blank).
 * Point them at the SPA origin so Vite can proxy those paths.
 */
export function injectSrcDocBaseHref(html: string, origin?: string): string {
  const raw = String(html || "");
  if (!raw.trim()) return raw;
  const fromWindow =
    typeof window !== "undefined" && window.location?.origin
      ? String(window.location.origin)
      : "";
  const baseOrigin = String(origin || fromWindow)
    .trim()
    .replace(/\/$/, "");
  if (!baseOrigin || baseOrigin === "null") return raw;
  if (/<base\b/i.test(raw)) return raw;
  const tag = `<base href="${baseOrigin}/">`;
  if (/<head\b[^>]*>/i.test(raw)) {
    return raw.replace(/<head\b[^>]*>/i, (open) => `${open}${tag}`);
  }
  if (/<html\b[^>]*>/i.test(raw)) {
    return raw.replace(/<html\b[^>]*>/i, (open) => `${open}<head>${tag}</head>`);
  }
  return `${tag}${raw}`;
}

/** Preferred <img src> for chat mini-previews (same-origin when possible). */
export function chatMediaPreviewSrc(
  url: string | null | undefined,
): string {
  return normalizeTemplateMediaUrl(url) || String(url || "").trim();
}

/**
 * Absolute fallback when same-origin /api/media 404s (e.g. older uploads that
 * only exist on rebuild). Returns null when there is nothing different to try.
 */
export function chatMediaPreviewFallbackSrc(
  url: string | null | undefined,
): string | null {
  const raw = String(url || "").trim();
  if (!raw || !/^https?:\/\//i.test(raw)) return null;
  const preferred = chatMediaPreviewSrc(raw);
  if (!preferred || preferred === raw) return null;
  return raw;
}

export function resolveTemplatePreviewImage(template: {
  previewImage?: string | null;
  preview?: { visualKey?: string; kind?: string } | null;
}): string | null {
  const preview = normalizeTemplateMediaUrl(template.previewImage);
  if (preview) return preview;
  const kind = template.preview?.kind;
  if (kind === "web_visual") {
    return template.previewImage || null;
  }
  // App push / SMS / text-only: no large photo (phone chrome stays clean).
  if (kind && !MEDIA_KINDS.has(kind)) return null;
  const key = template.preview?.visualKey;
  if (key && B2B_PREVIEW_BY_VISUAL_KEY[key]) {
    return B2B_PREVIEW_BY_VISUAL_KEY[key];
  }
  return null;
}
