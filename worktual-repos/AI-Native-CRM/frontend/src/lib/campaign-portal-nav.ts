/** CRM Marketing parent routes → Campaign SPA iframe paths (never /marketing inside iframe). */

const DEFAULT_CAMPAIGN_PATH = "/dashboard";

/** Exact CRM pathname → Campaign pathname (search params preserved separately). */
export const CRM_TO_CAMPAIGN_PATH: Record<string, string> = {
  "/marketing": "/dashboard",
  "/marketing/dashboard": "/dashboard",
  "/marketing/create": "/campaigns/create",
  "/marketing/campaigns": "/campaigns",
  "/marketing/events": "/events",
  "/marketing/audience": "/audience",
  "/marketing/configuration": "/configuration",
  /** Legacy CRM tabs → canonical Campaign paths */
  "/marketing/inbox": "/dashboard",
  "/marketing/customers": "/audience",
  "/marketing/templates": "/campaigns/create",
  "/marketing/recommendations": "/campaigns/create/recommendations",
  "/configuration/campaign": "/configuration",
};

const PREFIX_MATCHERS: Array<{
  prefix: string;
  map: (rest: string) => string | null;
}> = [
  {
    prefix: "/marketing/create/",
    map: (rest) => {
      if (!rest) return null;
      if (rest === "recommendations" || rest.startsWith("recommendations/")) {
        return `/campaigns/create/${rest}`;
      }
      // draftId or hub tools as path segments Campaign owns
      return `/campaigns/create/${rest}`;
    },
  },
  {
    prefix: "/marketing/audience/",
    map: (rest) => {
      if (!rest) return null;
      return `/audience/${rest}`;
    },
  },
  {
    prefix: "/marketing/campaigns/",
    map: (rest) => {
      if (!rest) return null;
      return `/campaigns/${rest}`;
    },
  },
  {
    prefix: "/marketing/events/",
    map: (rest) => {
      if (!rest) return null;
      return `/events/${rest}`;
    },
  },
];

function stripEmbedParams(search: string): string {
  const raw = search.startsWith("?") ? search.slice(1) : search;
  if (!raw) return "";
  const params = new URLSearchParams(raw);
  params.delete("embed");
  params.delete("crm_token");
  const qs = params.toString();
  return qs ? `?${qs}` : "";
}

export function campaignPathForCrmPathname(pathname: string, search = ""): string {
  const normalized = pathname.replace(/\/$/, "") || "/marketing";
  const suffix = stripEmbedParams(
    search ? (search.startsWith("?") ? search : `?${search}`) : "",
  );

  for (const { prefix, map } of PREFIX_MATCHERS) {
    if (!normalized.startsWith(prefix)) continue;
    const rest = normalized.slice(prefix.length);
    const mapped = map(rest);
    if (mapped) return mapped + suffix;
  }

  const base = CRM_TO_CAMPAIGN_PATH[normalized] ?? DEFAULT_CAMPAIGN_PATH;
  return base + suffix;
}

/** Soft-nav / iframe paths must always include embed=1. */
export function withCampaignEmbedQuery(pathAndSearch: string): string {
  const trimmed = pathAndSearch.trim() || DEFAULT_CAMPAIGN_PATH;
  const raw = trimmed.startsWith("/") ? trimmed : `/${trimmed}`;
  const qIdx = raw.indexOf("?");
  const pathname = qIdx >= 0 ? raw.slice(0, qIdx) : raw;
  const params = new URLSearchParams(qIdx >= 0 ? raw.slice(qIdx + 1) : "");
  params.set("embed", "1");
  params.delete("crm_token");
  return `${pathname}?${params.toString()}`;
}

export function campaignNavigatePath(pathAndSearch: string): string {
  return withCampaignEmbedQuery(pathAndSearch);
}

/**
 * Campaign → CRM parent URL sync (LOCATION). Never post NAVIGATE in response.
 * Returns full CRM path including search, or null if unmapped.
 */
export function crmPathnameForCampaignLocation(campaignLocation: string): string | null {
  const raw = campaignLocation.trim();
  if (!raw) return null;

  const withSlash = raw.startsWith("/") ? raw : `/${raw}`;
  const url = new URL(withSlash, "http://campaign.local");
  const p = url.pathname.replace(/\/$/, "") || "/";
  const search = stripEmbedParams(url.search);

  if (p === "/dashboard" || p === "/reports" || p === "/inbox") {
    return `/marketing/dashboard${search}`;
  }
  if (p.startsWith("/campaigns/create/")) {
    const tail = p.slice("/campaigns/create/".length);
    if (tail) return `/marketing/create/${tail}${search}`;
  }
  if (p === "/campaigns/create") {
    return `/marketing/create${search}`;
  }
  if (p === "/campaigns/calendar" || p === "/campaigns/on-demand") {
    return `/marketing/campaigns${search}`;
  }
  const campaignDetail = p.match(/^\/campaigns\/([^/]+)$/);
  if (
    campaignDetail &&
    !["create", "calendar", "on-demand"].includes(campaignDetail[1])
  ) {
    const params = new URLSearchParams(search.replace(/^\?/, ""));
    if (!params.has("id")) params.set("id", campaignDetail[1]);
    const qs = params.toString();
    return `/marketing/campaigns${qs ? `?${qs}` : ""}`;
  }
  if (p === "/campaigns" || p.startsWith("/campaigns/")) {
    return `/marketing/campaigns${search}`;
  }
  if (p.startsWith("/audience/")) {
    const id = p.slice("/audience/".length);
    if (id.startsWith("create/")) {
      return `/marketing/audience${search}`;
    }
    if (id) {
      return `/marketing/audience/${id}${search}`;
    }
  }
  if (p === "/audience" || p.startsWith("/contacts")) {
    return `/marketing/audience${search}`;
  }
  if (p === "/events" || p.startsWith("/events/")) {
    if (p === "/events") return `/marketing/events${search}`;
    return `/marketing/events/${p.slice("/events/".length)}${search}`;
  }
  if (p === "/configuration" || p.startsWith("/configuration/")) {
    return `/marketing/configuration${search}`;
  }
  return null;
}

export function isCampaignEmbedRoute(pathname: string): boolean {
  if (pathname.startsWith("/contact")) return false;
  if (pathname.startsWith("/reports")) return false;
  if (pathname === "/marketing/seo" || pathname.startsWith("/marketing/seo/")) {
    return false;
  }
  if (
    pathname.startsWith("/configuration") &&
    !pathname.startsWith("/configuration/campaign")
  ) {
    return false;
  }
  return (
    pathname === "/marketing" ||
    pathname.startsWith("/marketing/") ||
    pathname.startsWith("/configuration/campaign")
  );
}

export function normalizeCampaignEmbedPath(path: string): string {
  const trimmed = path.trim();
  const withSlash = trimmed.startsWith("/") ? trimmed : `/${trimmed}`;
  const qIdx = withSlash.indexOf("?");
  const pathname = qIdx >= 0 ? withSlash.slice(0, qIdx) : withSlash;
  return pathname.replace(/\/+$/, "") || DEFAULT_CAMPAIGN_PATH;
}

/** postMessage targetOrigin — scheme+host+port only (no path). */
export function campaignPostMessageOrigin(uiBaseUrl: string): string {
  try {
    return new URL(uiBaseUrl).origin;
  } catch {
    return uiBaseUrl.replace(/\/$/, "");
  }
}

/**
 * Iframe must load Campaign host directly. CRM /campaign-proxy only serves HTML;
 * Campaign Vite assets use absolute /src paths and would load CRM inside the iframe.
 */
export function resolveCampaignIframeBase(uiOrigin: string | null): string | null {
  if (!uiOrigin) return null;
  const trimmed = uiOrigin.trim().replace(/\/$/, "");
  if (trimmed.includes("/campaign-proxy")) {
    return null;
  }
  try {
    const url = new URL(trimmed);
    return url.origin;
  } catch {
    return trimmed;
  }
}

/** Build iframe src: {origin}{path}?embed=1&crm_token=… */
export function buildCampaignEmbedSrc(
  uiOrigin: string,
  campaignPath: string,
  token: string,
): string {
  const origin = resolveCampaignIframeBase(uiOrigin) ?? uiOrigin.replace(/\/$/, "");
  const pathWithEmbed = withCampaignEmbedQuery(campaignPath);
  const url = new URL(pathWithEmbed, `${origin}/`);
  url.searchParams.set("crm_token", token);
  return url.toString();
}

export type CampaignPostMessage =
  | { type: "worktual:campaign-auth"; token: string }
  | { type: "worktual:campaign-navigate"; path: string }
  | { type: "worktual:campaign-ready"; path?: string }
  | { type: "worktual:campaign-nav"; path?: string }
  | { type: "worktual:campaign-location"; path?: string };

export function isCampaignInboundMessage(
  data: unknown,
): data is Exclude<CampaignPostMessage, { type: "worktual:campaign-auth" }> {
  if (!data || typeof data !== "object") return false;
  const type = (data as { type?: unknown }).type;
  return (
    type === "worktual:campaign-ready" ||
    type === "worktual:campaign-nav" ||
    type === "worktual:campaign-location"
  );
}
