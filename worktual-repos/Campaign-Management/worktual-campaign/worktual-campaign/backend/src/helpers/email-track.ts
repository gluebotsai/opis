/**
 * Inject open pixel + click wrappers + unsubscribe into campaign HTML.
 *
 * `apiBase` must be the public API origin (API_PUBLIC_URL), e.g.
 * https://rebuild-campaign-api.worktual.com — Gmail/Outlook load the pixel
 * and follow click redirects from the open internet.
 *
 * Option A (email clicks):
 *   href → {API}/api/campaigns/track/click/{recipientId}?u={destination + UTM + wt}
 *   Campaign records click rate, then redirects to the template destination
 *   with utm_* and wt={token} (KB/user/form URL — tracking applied at send).
 *
 * Unsubscribe (forced compliance footer):
 *   href → {API}/api/campaigns/track/unsubscribe/{recipientId}
 *   Not wrapped by click tracker. Marks engagement + email_suppressions.
 */

import { applyWebTrackingParamsToUrl, type WebTrackingIds } from "./web-tracking-link.js";

const PIXEL_GIF = Buffer.from(
  "R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7",
  "base64",
);

export function trackingPixelGif(): Buffer {
  return PIXEL_GIF;
}

export function emailTrackOpenUrl(apiBase: string, recipientId: string): string {
  const base = apiBase.replace(/\/$/, "");
  return `${base}/api/campaigns/track/open/${encodeURIComponent(recipientId)}`;
}

export function emailTrackClickUrl(
  apiBase: string,
  recipientId: string,
  dest: string,
): string {
  const base = apiBase.replace(/\/$/, "");
  const u = encodeURIComponent(dest);
  return `${base}/api/campaigns/track/click/${encodeURIComponent(recipientId)}?u=${u}`;
}

/** One-click / link unsubscribe — no auth; recipient id is the capability token. */
export function emailUnsubscribeUrl(
  apiBase: string,
  recipientId: string,
): string {
  const base = apiBase.replace(/\/$/, "");
  return `${base}/api/campaigns/track/unsubscribe/${encodeURIComponent(recipientId)}`;
}

/** App / web notification tap — no destination redirect. */
export function pushTrackClickUrl(apiBase: string, recipientId: string): string {
  const base = apiBase.replace(/\/$/, "");
  return `${base}/api/campaigns/track/push-click/${encodeURIComponent(recipientId)}`;
}

/**
 * FCM data / web-push JSON fields. Config test sends omit this (no recipient).
 * click_url wraps an http(s) dest with the existing click tracker, else the tap endpoint.
 */
export function pushCampaignDataPayload(args: {
  apiBase: string;
  recipientId: string;
  campaignId: string;
  channel: "push" | "web";
  destUrl?: string | null;
}): Record<string, string> {
  const dest = safeTrackRedirect(args.destUrl);
  return {
    recipient_id: String(args.recipientId),
    campaign_id: String(args.campaignId),
    channel: args.channel,
    click_url: dest
      ? emailTrackClickUrl(args.apiBase, args.recipientId, dest)
      : pushTrackClickUrl(args.apiBase, args.recipientId),
  };
}

function isDummyCtaHref(value: string): boolean {
  const raw = String(value || "").trim();
  if (!raw) return true;
  const lower = raw.toLowerCase();
  return (
    lower.startsWith("#") ||
    lower.startsWith("javascript:") ||
    lower === "about:blank" ||
    lower === "/"
  );
}

/** href="#" / empty / leftover {{campaign_url}} → tracked landing so wt= can attach. */
export function rewriteDummyCtaHrefs(html: string, dest: string): string {
  const landing = String(dest || "").trim();
  if (!html || !landing) return html;
  return html.replace(/<a\b([^>]*)>/gi, (full, attrs: string) => {
    if (/unsubscribe/i.test(attrs)) return full;
    const href = /href\s*=\s*(["'])([\s\S]*?)\1/i.exec(attrs);
    if (!href) {
      return `<a href="${landing}"${attrs}>`;
    }
    const val = href[2].trim();
    if (isDummyCtaHref(val) || /\{\{\s*campaign_url\s*\}\}/i.test(val)) {
      return full.replace(href[0], `href=${href[1]}${landing}${href[1]}`);
    }
    return full;
  });
}

function escapeAttr(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/** True when HTML already has a live unsubscribe track link. */
export function htmlHasUnsubscribeLink(html: string): boolean {
  return /\/api\/campaigns\/track\/unsubscribe\//i.test(html);
}

/**
 * Append a muted Unsubscribe footer when missing (forced_unsubscribe compliance).
 * Call after {{unsubscribe_url}} merge replacement.
 */
export function ensureEmailUnsubscribeFooter(
  html: string,
  unsubscribeUrl: string,
): string {
  if (!html || !unsubscribeUrl) return html;
  if (htmlHasUnsubscribeLink(html)) return html;
  const footer =
    `<p style="margin-top:24px;font-size:12px;color:#666;text-align:center">` +
    `<a href="${escapeAttr(unsubscribeUrl)}" style="color:#666;text-decoration:underline">Unsubscribe</a>` +
    `</p>`;
  if (/<\/body>/i.test(html)) {
    return html.replace(/<\/body>/i, `${footer}</body>`);
  }
  return `${html}${footer}`;
}

/** Plain-text unsubscribe line when missing. */
export function ensureEmailUnsubscribeText(
  text: string,
  unsubscribeUrl: string,
): string {
  if (!unsubscribeUrl) return text || "";
  const body = String(text || "");
  if (/\/api\/campaigns\/track\/unsubscribe\//i.test(body)) return body;
  if (/unsubscribe:\s*https?:\/\//i.test(body)) return body;
  const line = `Unsubscribe: ${unsubscribeUrl}`;
  return body.trim() ? `${body.trim()}\n\n${line}` : line;
}

/**
 * Wrap http(s) links with Campaign click tracker; append open pixel + unsubscribe.
 * Each marketing href keeps its own destination; send stamps UTM + wt= onto that URL
 * then wraps with track/click?u=…
 * Unsubscribe hrefs are never click-wrapped.
 */
export function attachEmailTracking(
  html: string,
  opts: {
    apiBase: string;
    recipientId: string;
    trackingIds?: WebTrackingIds;
    hmacSecret?: string;
    campaignName?: string;
    utmMedium?: string;
    /** Used only for leftover {{campaign_url}} / dummy hrefs. */
    fallbackDest?: string | null;
  },
): string {
  if (!html || !opts.recipientId) return html;
  const openUrl = emailTrackOpenUrl(opts.apiBase, opts.recipientId);
  const unsubUrl = emailUnsubscribeUrl(opts.apiBase, opts.recipientId);
  const withMerge = html.replace(
    /\{\{\s*unsubscribe_url\s*\}\}/gi,
    unsubUrl,
  );
  const withUnsub = ensureEmailUnsubscribeFooter(withMerge, unsubUrl);
  const fallback = safeTrackRedirect(opts.fallbackDest) || "";
  const withCtas = rewriteDummyCtaHrefs(withUnsub, fallback);
  const secret = String(opts.hmacSecret || "").trim();
  const ids = opts.trackingIds;
  const wrapped = withCtas.replace(
    /href=(["'])(https?:\/\/[^"']+)\1/gi,
    (_m, quote: string, href: string) => {
      if (/\/api\/campaigns\/track\//i.test(href)) {
        return `href=${quote}${href}${quote}`;
      }
      let dest = href;
      if (ids && secret) {
        dest =
          applyWebTrackingParamsToUrl(href, ids, secret, {
            campaignName: opts.campaignName,
            utmMedium: opts.utmMedium || "email",
          }) || href;
      }
      const tracked = emailTrackClickUrl(opts.apiBase, opts.recipientId, dest);
      return `href=${quote}${tracked}${quote}`;
    },
  );
  const pixel = `<img src="${openUrl}" width="1" height="1" alt="" style="display:block;width:1px;height:1px;border:0" />`;
  if (/<\/body>/i.test(wrapped)) {
    return wrapped.replace(/<\/body>/i, `${pixel}</body>`);
  }
  return `${wrapped}${pixel}`;
}

export function safeTrackRedirect(raw: unknown): string | null {
  const url = String(raw || "").trim();
  if (!url || url.length > 4096) return null;
  if (!/^https?:\/\//i.test(url)) return null;
  if (/[\s<>]/.test(url)) return null;
  return url;
}

function hostnameOf(raw: string): string | null {
  try {
    return new URL(raw).hostname.toLowerCase().replace(/^www\./, "");
  } catch {
    return null;
  }
}

/** Campaign product UI — never a customer landing for web/app push taps. */
const CAMPAIGN_APP_HOSTS = new Set(["rebuild-campaign.worktual.com"]);

export function isCampaignAppLandingUrl(
  raw: unknown,
  appUrl: string,
): boolean {
  const dest = safeTrackRedirect(raw);
  if (!dest) return false;
  const destHost = hostnameOf(dest);
  if (!destHost) return false;
  if (CAMPAIGN_APP_HOSTS.has(destHost)) return true;
  const appHost = hostnameOf(String(appUrl || "").trim());
  return Boolean(appHost && destHost === appHost);
}

/**
 * Push tap destination: template CTA, then merge campaign_url, then Accounts
 * default click. Never Campaign Management (`appUrl`).
 */
export function resolvePushClickDest(args: {
  ctaUrl?: string | null;
  campaignUrl?: string | null;
  defaultClickUrl?: string | null;
  appUrl: string;
}): string | null {
  const appUrl = String(args.appUrl || "").trim();
  for (const candidate of [args.ctaUrl, args.campaignUrl, args.defaultClickUrl]) {
    const dest = safeTrackRedirect(candidate);
    if (!dest) continue;
    if (isCampaignAppLandingUrl(dest, appUrl)) continue;
    return dest;
  }
  return null;
}

/** First Campaign click-wrapper href in outbound HTML (for send-time QA logs). */
export function extractTrackClickHref(html: string): string | null {
  const m = String(html || "").match(
    /href=(["'])(https?:\/\/[^"']*\/api\/campaigns\/track\/click\/[^"']+)\1/i,
  );
  return m?.[2] ?? null;
}

export function htmlContainsWtToken(raw: string | null | undefined): boolean {
  const s = String(raw || "");
  return /[?&]wt=/i.test(s) || /wt%3D/i.test(s);
}

/**
 * True when HTML has an http(s) href that is not unsubscribe / open pixel.
 * Templates with only Unsubscribe should still send (no CTA to stamp wt= on).
 */
export function emailHtmlHasOutboundCtaHref(html: string): boolean {
  const re = /href=(["'])(https?:\/\/[^"']+)\1/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(String(html || "")))) {
    const href = m[2] || "";
    if (/\/api\/campaigns\/track\/unsubscribe\//i.test(href)) continue;
    if (/\/api\/campaigns\/track\/open\//i.test(href)) continue;
    return true;
  }
  return false;
}
