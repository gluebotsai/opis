/**
 * Event-driven campaign recommendations (Phase 1 — seeded calendar cues).
 * Later: wire to Events tracking / campaign_db.
 */

export type CampaignRecommendation = {
  id: string;
  title: string;
  /** Short cue shown as badge, e.g. "In 4 days" */
  timingLabel: string;
  eventName: string;
  daysUntil: number;
  goal: string;
  channels: string[];
  audience: string;
  flowSteps: string[];
  starterMessage: string;
};

type SeedEvent = {
  id: string;
  eventName: string;
  /** Days from today */
  daysUntil: number;
  goal: string;
  channels: string[];
  audience: string;
  campaignTitle: string;
  flowSteps: string[];
};

const SEED_EVENTS: SeedEvent[] = [
  {
    id: "rec-festive-4d",
    eventName: "Festival sale window",
    daysUntil: 4,
    goal: "Sales / conversions",
    channels: ["Email", "WhatsApp", "SMS"],
    audience: "B2C active customers",
    campaignTitle: "Festival sale blast",
    flowSteps: [
      "Audience enters campaign",
      "First touch: Email",
      "Next touch: WhatsApp",
      "Next touch: SMS",
      "Offer redeem / purchase",
    ],
  },
  {
    id: "rec-weekend-2d",
    eventName: "Weekend flash deal",
    daysUntil: 2,
    goal: "Engagement",
    channels: ["Email", "Web Push"],
    audience: "Engaged contacts",
    campaignTitle: "Weekend flash deal",
    flowSteps: [
      "Audience enters campaign",
      "First touch: Email",
      "Next touch: Web Push",
      "Conversion / exit",
    ],
  },
  {
    id: "rec-webinar-6d",
    eventName: "Product webinar",
    daysUntil: 6,
    goal: "Webinar registrations",
    channels: ["Email"],
    audience: "Engaged contacts",
    campaignTitle: "Webinar invite sequence",
    flowSteps: [
      "Audience enters campaign",
      "First touch: Email",
      "Webinar registration / attend",
    ],
  },
  {
    id: "rec-restock-1d",
    eventName: "Wishlist restock drop",
    daysUntil: 1,
    goal: "Sales / conversions",
    channels: ["App Push", "WhatsApp"],
    audience: "App users with wishlist",
    campaignTitle: "Restock alert campaign",
    flowSteps: [
      "Audience enters campaign",
      "First touch: App Push",
      "Next touch: WhatsApp",
      "Offer redeem / purchase",
    ],
  },
];

function timingLabel(daysUntil: number): string {
  if (daysUntil <= 0) return "Today";
  if (daysUntil === 1) return "In 1 day";
  return `In ${daysUntil} days`;
}

export function listCampaignRecommendations(): CampaignRecommendation[] {
  return SEED_EVENTS.map((e) => ({
    id: e.id,
    title: e.campaignTitle,
    timingLabel: timingLabel(e.daysUntil),
    eventName: e.eventName,
    daysUntil: e.daysUntil,
    goal: e.goal,
    channels: e.channels,
    audience: e.audience,
    flowSteps: e.flowSteps,
    starterMessage: `${e.eventName} is ${timingLabel(e.daysUntil).toLowerCase()}. I started a draft for “${e.campaignTitle}”. Tell me what to adjust.`,
  })).sort((a, b) => a.daysUntil - b.daysUntil);
}
