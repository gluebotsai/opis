/**
 * Designed PPC ad plan templates (local seed catalog) for Meta / Google hubs.
 */

export type PpcNetwork = "meta" | "google";

export type PpcKeywordMatch = "broad" | "phrase" | "exact";

/** Meta: text only. Google: text + match (phrase default). */
export type PpcKeyword = {
  text: string;
  match?: PpcKeywordMatch;
};

export type PpcCreativeFormat = "image" | "video" | "carousel";
export type PpcPlacement =
  | "feed"
  | "stories"
  | "reels"
  | "audience_network"
  | "right_column"
  | "search";
export type PpcCampaignType = "search" | "pmax" | "display";

export type PpcMedia = {
  type?: "image" | "video";
  url?: string;
  asset_id?: string;
  alt?: string;
};

export type PpcTemplatePlan = {
  network: PpcNetwork;
  objective: "awareness" | "traffic" | "leads" | "sales";
  campaign_type?: PpcCampaignType | "";
  creative_format?: PpcCreativeFormat | "";
  placements?: PpcPlacement[];
  headlines: string[];
  primary_text: string;
  descriptions?: string;
  cta: string;
  landing_url: string;
  daily_budget: string;
  currency: string;
  geo: string[];
  keywords: PpcKeyword[];
  audience_notes: string;
  media?: PpcMedia;
};

export type PpcAdTemplate = {
  id: string;
  name: string;
  description: string;
  network: PpcNetwork;
  status: "designed" | "drafted";
  plan: PpcTemplatePlan;
  updatedAt: string;
};

const SEED: PpcAdTemplate[] = [
  {
    id: "ppc-meta-summer-sale",
    name: "Summer Sale — Meta Feed",
    description: "Traffic plan for seasonal retail on Facebook & Instagram.",
    network: "meta",
    status: "designed",
    plan: {
      network: "meta",
      objective: "traffic",
      creative_format: "image",
      placements: ["feed", "stories"],
      headlines: [
        "Summer deals in your city",
        "Shop the season sale",
        "Limited-time festive prices",
      ],
      primary_text:
        "Discover summer picks with early-bird pricing. Free delivery on select orders — tap to browse before stock runs out.",
      descriptions: "Social proof + urgency for feed placements.",
      cta: "Shop now",
      landing_url: "",
      daily_budget: "5000",
      currency: "INR",
      geo: ["Chennai", "Bangalore"],
      keywords: [
        { text: "summer sale" },
        { text: "festive offers" },
        { text: "online shopping" },
      ],
      audience_notes: "Ages 25–45; lookalike of past buyers; shopping & lifestyle",
      media: {
        type: "image",
        url: "",
        alt: "Summer product collage placeholder",
      },
    },
    updatedAt: "2026-07-01T10:00:00.000Z",
  },
  {
    id: "ppc-meta-webinar",
    name: "Product Webinar — Meta Video",
    description: "Lead-gen video creative for webinar registrations.",
    network: "meta",
    status: "designed",
    plan: {
      network: "meta",
      objective: "leads",
      creative_format: "video",
      placements: ["feed", "reels", "stories"],
      headlines: [
        "Free live product demo",
        "Reserve your webinar seat",
        "Learn the new features live",
      ],
      primary_text:
        "Join our live session and see how teams cut busywork. Limited seats — register in one tap.",
      cta: "Register free",
      landing_url: "",
      daily_budget: "3500",
      currency: "INR",
      geo: ["India"],
      keywords: [
        { text: "product webinar" },
        { text: "demo signup" },
        { text: "SaaS training" },
      ],
      audience_notes: "Ages 28–50; engaged website visitors last 30 days",
      media: {
        type: "video",
        url: "",
        alt: "Webinar teaser video placeholder",
      },
    },
    updatedAt: "2026-07-05T10:00:00.000Z",
  },
  {
    id: "ppc-google-crm-search",
    name: "CRM Search — Google Ads",
    description: "Search plan with keywords for high-intent CRM queries.",
    network: "google",
    status: "designed",
    plan: {
      network: "google",
      objective: "leads",
      campaign_type: "search",
      headlines: [
        "CRM built for growing teams",
        "Try CRM free this week",
        "Close deals faster with CRM",
      ],
      primary_text:
        "See pipeline, follow-ups, and reports in one place. Start free — no card required.",
      descriptions: "RSA-style supporting lines for Search.",
      cta: "Start free",
      landing_url: "",
      daily_budget: "8000",
      currency: "INR",
      geo: ["India"],
      keywords: [
        { text: "crm software", match: "phrase" },
        { text: "best crm for small business", match: "phrase" },
        { text: "crm tools india", match: "broad" },
        { text: "sales crm free trial", match: "exact" },
      ],
      audience_notes: "Search intent: CRM comparison and trial",
    },
    updatedAt: "2026-07-08T10:00:00.000Z",
  },
  {
    id: "ppc-google-local-service",
    name: "Local Service — Google Search",
    description: "Geo-targeted search ads for local service bookings.",
    network: "google",
    status: "designed",
    plan: {
      network: "google",
      objective: "traffic",
      campaign_type: "search",
      headlines: [
        "Book trusted local service",
        "Same-week appointments",
        "Rated pros near you",
      ],
      primary_text:
        "Compare verified providers in your area and book online in minutes.",
      cta: "Book now",
      landing_url: "",
      daily_budget: "4000",
      currency: "INR",
      geo: ["Chennai"],
      keywords: [
        { text: "local service near me", match: "phrase" },
        { text: "book service chennai", match: "phrase" },
        { text: "home service appointment", match: "exact" },
      ],
      audience_notes: "Radius targeting around Chennai",
    },
    updatedAt: "2026-07-10T10:00:00.000Z",
  },
];

export const PPC_PLATFORMS: Array<{
  id: PpcNetwork;
  label: string;
  hint: string;
}> = [
  { id: "meta", label: "Meta", hint: "Facebook & Instagram ads" },
  { id: "google", label: "Google", hint: "Search & Performance plans" },
];

export function listPpcTemplates(network?: PpcNetwork): PpcAdTemplate[] {
  const rows = [...SEED].sort(
    (a, b) =>
      new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime(),
  );
  if (!network) return rows;
  return rows.filter((t) => t.network === network);
}

export function getPpcTemplate(id: string): PpcAdTemplate | undefined {
  return SEED.find((t) => t.id === id);
}

export function ppcNetworkLabel(network: PpcNetwork): string {
  return network === "google" ? "Google" : "Meta";
}
