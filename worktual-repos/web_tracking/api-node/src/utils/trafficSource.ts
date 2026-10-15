import { isSessionBounce } from "./bounceRate.js";

export const SEARCH_ENGINES: Record<string, string> = {
  google: "Google",
  bing: "Bing",
  yahoo: "Yahoo",
  duckduckgo: "DuckDuckGo",
  baidu: "Baidu",
  yandex: "Yandex",
  ecosia: "Ecosia",
};

export const SOCIAL_NETWORKS: Record<string, string> = {
  "facebook.com": "Facebook",
  "fb.com": "Facebook",
  "instagram.com": "Instagram",
  "twitter.com": "Twitter",
  "x.com": "X",
  "linkedin.com": "LinkedIn",
  "t.co": "Twitter",
  "pinterest.com": "Pinterest",
  "reddit.com": "Reddit",
  "tiktok.com": "TikTok",
  "youtube.com": "YouTube",
};

export const PAID_MEDIUMS = new Set(["cpc", "ppc", "paid", "paidsearch", "cpv", "paidsocial"]);
export const EMAIL_MEDIUMS = new Set(["email", "e-mail", "newsletter"]);
export const AFFILIATE_MEDIUMS = new Set(["affiliate", "partner"]);
export const DISPLAY_MEDIUMS = new Set(["display", "banner", "cpm", "retargeting"]);
export const SOCIAL_MEDIUMS = new Set(["social", "social-media", "sm"]);

export const CHANNEL_LABELS: Record<string, string> = {
  direct: "Direct Traffic",
  organic_search: "Organic Search",
  referral: "Referral",
  social: "Social",
  paid_search: "Paid Search",
  email: "Email",
  display: "Display",
  affiliate: "Affiliate",
  other: "Other",
};

export const CARD_CHANNELS = ["direct", "organic_search", "referral", "social", "paid_search"] as const;

export const DISPLAY_CHANNELS = [
  "direct",
  "organic_search",
  "referral",
  "social",
  "paid_search",
  "email",
  "other",
] as const;

export interface TrafficSourceSessionRow {
  session_id: string;
  visitor_id: string;
  referrer?: string | null;
  referrer_domain?: string | null;
  utm_source?: string | null;
  utm_medium?: string | null;
  utm_campaign?: string | null;
  pageview_count?: number | null;
  duration_seconds?: number | null;
  conversions?: number | null;
}

function normalize(value: string | null | undefined): string {
  return (value ?? "").trim().toLowerCase();
}

function normalizeDomain(domain: string | null | undefined): string {
  let d = normalize(domain);
  if (d.startsWith("www.")) d = d.slice(4);
  return d;
}

function detectSearchEngine(...values: (string | null | undefined)[]): string | null {
  for (const value of values) {
    const text = normalize(value);
    if (!text) continue;
    for (const [key, name] of Object.entries(SEARCH_ENGINES)) {
      if (text.includes(key)) return name;
    }
  }
  return null;
}

function detectSocialNetwork(domain: string | null | undefined): string | null {
  const d = normalizeDomain(domain);
  if (!d) return null;
  for (const [key, name] of Object.entries(SOCIAL_NETWORKS)) {
    if (d === key || d.endsWith(`.${key}`) || d.includes(key)) return name;
  }
  return null;
}

function isDirect(
  referrer: string | null | undefined,
  referrerDomain: string | null | undefined,
  utmSource: string | null | undefined,
  utmMedium: string | null | undefined,
): boolean {
  if (normalize(utmSource) || normalize(utmMedium)) return false;
  const ref = normalize(referrer);
  if (!ref || ref === "direct" || ref === "(direct)" || ref === "none") return true;
  return !normalizeDomain(referrerDomain);
}

export function classifyChannel(
  referrer: string | null | undefined,
  referrerDomain: string | null | undefined,
  utmSource: string | null | undefined,
  utmMedium: string | null | undefined,
  _utmCampaign?: string | null,
): string {
  const utmSourceN = normalize(utmSource);
  const utmMediumN = normalize(utmMedium);
  const referrerDomainN = normalizeDomain(referrerDomain);

  if (EMAIL_MEDIUMS.has(utmMediumN) || ["email", "newsletter", "mailchimp", "sendgrid"].includes(utmSourceN)) {
    return "email";
  }
  if (AFFILIATE_MEDIUMS.has(utmMediumN)) return "affiliate";
  if (DISPLAY_MEDIUMS.has(utmMediumN)) return "display";
  if (PAID_MEDIUMS.has(utmMediumN)) return "paid_search";
  if (SOCIAL_MEDIUMS.has(utmMediumN)) return "social";

  const social = detectSocialNetwork(referrerDomainN);
  if (social) {
    if (PAID_MEDIUMS.has(utmMediumN)) return "paid_search";
    return "social";
  }

  const search = detectSearchEngine(referrerDomainN, utmSourceN);
  if (search) {
    if (PAID_MEDIUMS.has(utmMediumN)) return "paid_search";
    return "organic_search";
  }

  if (isDirect(referrer, referrerDomainN, utmSourceN, utmMediumN)) return "direct";
  if (referrerDomainN || normalize(referrer)) return "referral";
  return "other";
}

export function displayChannel(channel: string): string {
  if ((DISPLAY_CHANNELS as readonly string[]).includes(channel)) return channel;
  return "other";
}

export function sourceLabel(
  referrer: string | null | undefined,
  referrerDomain: string | null | undefined,
  utmSource: string | null | undefined,
  utmMedium: string | null | undefined,
  _utmCampaign: string | null | undefined,
  channel: string,
): string {
  const utmSourceN = normalize(utmSource);
  const referrerDomainN = normalizeDomain(referrerDomain);

  if (channel === "direct") return "Direct";
  if (channel === "email") {
    if (utmSourceN && utmSourceN !== "email" && utmSourceN !== "newsletter") {
      return `${utmSourceN.charAt(0).toUpperCase()}${utmSourceN.slice(1)} Email`;
    }
    return "Email";
  }
  if (channel === "affiliate") return (utmSourceN || referrerDomainN || "Affiliate").replace(/\b\w/g, (c) => c.toUpperCase());
  if (channel === "display") return `${(utmSourceN || "Display").replace(/\b\w/g, (c) => c.toUpperCase())} Ads`;

  if (channel === "paid_search") {
    const search = detectSearchEngine(referrerDomainN, utmSourceN);
    if (search) return `${search} Ads`;
    if (utmSourceN) return `${utmSourceN.charAt(0).toUpperCase()}${utmSourceN.slice(1)} Ads`;
    return "Paid Search";
  }

  if (channel === "social") {
    const social = detectSocialNetwork(referrerDomainN);
    if (social) return social;
    if (utmSourceN) return utmSourceN.charAt(0).toUpperCase() + utmSourceN.slice(1);
    return "Social";
  }

  if (channel === "organic_search") {
    const search = detectSearchEngine(referrerDomainN);
    if (search) return `${search} Organic`;
    return "Organic Search";
  }

  if (channel === "referral") {
    if (referrerDomainN) return referrerDomainN.charAt(0).toUpperCase() + referrerDomainN.slice(1);
    const ref = (referrer ?? "").trim();
    if (ref) return ref.slice(0, 80);
    return "Referral";
  }

  if (utmSourceN) return utmSourceN.charAt(0).toUpperCase() + utmSourceN.slice(1);
  return "Other";
}

export function aggregateTrafficSources(rows: TrafficSourceSessionRow[]) {
  const totalSessions = rows.length;
  const totalVisitors = new Set(rows.map((r) => r.visitor_id)).size;

  const channelStats: Record<
    string,
    {
      channel: string;
      source: string;
      visitors: Set<string>;
      sessions: number;
      conversions: number;
      bounce_sessions: number;
      eligible_bounce_sessions: number;
    }
  > = {};
  const sourceStats: Record<
    string,
    {
      channel: string;
      source: string;
      visitors: Set<string>;
      sessions: number;
      conversions: number;
      bounce_sessions: number;
      eligible_bounce_sessions: number;
    }
  > = {};

  for (const row of rows) {
    const channel = classifyChannel(
      row.referrer,
      row.referrer_domain,
      row.utm_source,
      row.utm_medium,
      row.utm_campaign,
    );
    const label = sourceLabel(
      row.referrer,
      row.referrer_domain,
      row.utm_source,
      row.utm_medium,
      row.utm_campaign,
      channel,
    );

    const pageviews = Number(row.pageview_count ?? 0);
    const durationSeconds = Number(row.duration_seconds ?? 0);
    const conversions = Number(row.conversions ?? 0);
    const isBounce = isSessionBounce(pageviews, durationSeconds);
    const hasPageviews = pageviews > 0;

    for (const [bucket, key] of [
      [channelStats, channel],
      [sourceStats, label],
    ] as const) {
      if (!bucket[key]) {
        bucket[key] = {
          channel,
          source: label,
          visitors: new Set(),
          sessions: 0,
          conversions: 0,
          bounce_sessions: 0,
          eligible_bounce_sessions: 0,
        };
      }
      bucket[key].visitors.add(row.visitor_id);
      bucket[key].sessions += 1;
      bucket[key].conversions += conversions;
      if (isBounce) bucket[key].bounce_sessions += 1;
      if (hasPageviews) bucket[key].eligible_bounce_sessions += 1;
    }
  }

  const pct = (part: number, whole: number) => (whole === 0 ? 0 : Math.round((part / whole) * 10000) / 100);

  const channelCards = CARD_CHANNELS.map((channel) => {
    const stats = channelStats[channel];
    const visitors = stats ? stats.visitors.size : 0;
    const sessions = stats ? stats.sessions : 0;
    return {
      channel,
      label: CHANNEL_LABELS[channel],
      visitors,
      sessions,
      percentage: pct(sessions, totalSessions),
    };
  });

  const sources = Object.entries(sourceStats)
    .map(([label, stats]) => {
      const visitors = stats.visitors.size;
      const sessions = stats.sessions;
      const eligible = stats.eligible_bounce_sessions;
      const bounceRate = eligible ? Math.round((stats.bounce_sessions / eligible) * 10000) / 100 : 0;
      return {
        source: label,
        channel: stats.channel,
        visitors,
        sessions,
        conversions: stats.conversions,
        bounce_rate: bounceRate,
      };
    })
    .sort((a, b) => b.visitors - a.visitors);

  const groupedChannels: Record<string, { source: string; channel: string; visitors: Set<string>; sessions: number }> =
    {};
  for (const channel of DISPLAY_CHANNELS) {
    groupedChannels[channel] = {
      source: CHANNEL_LABELS[channel],
      channel,
      visitors: new Set(),
      sessions: 0,
    };
  }

  for (const row of rows) {
    const channel = classifyChannel(
      row.referrer,
      row.referrer_domain,
      row.utm_source,
      row.utm_medium,
      row.utm_campaign,
    );
    const bucket = displayChannel(channel);
    groupedChannels[bucket].visitors.add(row.visitor_id);
    groupedChannels[bucket].sessions += 1;
  }

  const channels = DISPLAY_CHANNELS.map((channel) => {
    const stats = groupedChannels[channel];
    const visitors = stats.visitors.size;
    const sessions = stats.sessions;
    return {
      source: stats.source,
      channel,
      visitors,
      sessions,
      percentage: pct(sessions, totalSessions),
    };
  });

  return {
    total_visitors: totalVisitors,
    total_sessions: totalSessions,
    channel_cards: channelCards,
    channels,
    chart: channels,
    sources,
  };
}
