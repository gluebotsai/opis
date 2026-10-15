/**
 * Past / completed campaigns available to clone into a new create-chat draft.
 * Phase 1: seeded catalog + any local drafts marked completed/live.
 */

import {
  channelLabel,
  type CampaignChannelId,
} from "@/lib/campaign-channels";
import {
  listCampaignDrafts,
  type CampaignChatDraft,
} from "@/lib/campaign-drafts";

export type PastCampaign = {
  id: string;
  name: string;
  goal: string;
  channels: string[];
  audience: string;
  schedule: string;
  flowSteps: string[];
  status: "live" | "completed" | "scheduled";
  completedAt: string;
  source: "catalog" | "draft";
};

const CATALOG: PastCampaign[] = [
  {
    id: "past-spring-launch",
    name: "Spring product launch",
    goal: "Awareness",
    channels: ["Email", "WhatsApp"],
    audience: "Engaged contacts",
    schedule: "Ran Mar 2026",
    flowSteps: [
      "Audience enters campaign",
      "First touch: Email",
      "Next touch: WhatsApp",
      "Conversion / exit",
    ],
    status: "completed",
    completedAt: "2026-03-28T10:00:00.000Z",
    source: "catalog",
  },
  {
    id: "past-festival-sale",
    name: "Festival sale blast",
    goal: "Sales / conversions",
    channels: ["Email", "SMS", "WhatsApp"],
    audience: "B2C active customers",
    schedule: "Ran Apr 2026",
    flowSteps: [
      "Audience enters campaign",
      "First touch: Email",
      "Next touch: SMS",
      "Next touch: WhatsApp",
      "Offer redeem / purchase",
    ],
    status: "completed",
    completedAt: "2026-04-15T10:00:00.000Z",
    source: "catalog",
  },
  {
    id: "past-q2-webinar",
    name: "Q2 product webinar",
    goal: "Webinar registrations",
    channels: ["Email"],
    audience: "Engaged contacts",
    schedule: "Ran May 2026",
    flowSteps: [
      "Audience enters campaign",
      "First touch: Email",
      "Webinar registration / attend",
    ],
    status: "completed",
    completedAt: "2026-05-20T10:00:00.000Z",
    source: "catalog",
  },
  {
    id: "past-sms-flash",
    name: "SMS flash sale",
    goal: "Sales / conversions",
    channels: ["SMS"],
    audience: "Opted-in promo segment",
    schedule: "Ran Jun 2026",
    flowSteps: ["Audience scrub", "Send promo SMS"],
    status: "completed",
    completedAt: "2026-06-10T10:00:00.000Z",
    source: "catalog",
  },
  {
    id: "past-web-push-deal",
    name: "Weekend web push",
    goal: "Engagement",
    channels: ["Web Push"],
    audience: "Subscribed browsers",
    schedule: "Ran Jun 2026",
    flowSteps: ["Audience enters", "Web push"],
    status: "completed",
    completedAt: "2026-06-14T10:00:00.000Z",
    source: "catalog",
  },
  {
    id: "past-app-push-restock",
    name: "App restock alert",
    goal: "Engagement",
    channels: ["App Push"],
    audience: "App users with wishlist",
    schedule: "Ran Jul 2026",
    flowSteps: ["Audience enters", "App push"],
    status: "completed",
    completedAt: "2026-07-02T10:00:00.000Z",
    source: "catalog",
  },
];

function draftToPast(d: CampaignChatDraft): PastCampaign | null {
  if (
    d.status !== "completed" &&
    d.status !== "live" &&
    d.status !== "scheduled"
  ) {
    return null;
  }
  return {
    id: `draft-${d.id}`,
    name: d.name,
    goal: d.goal,
    channels: d.channels,
    audience: d.audience,
    schedule: d.schedule,
    flowSteps: d.flowSteps,
    status: d.status === "scheduled" ? "scheduled" : d.status,
    completedAt: d.launchedAt ?? d.updatedAt,
    source: "draft",
  };
}

export function listPastCampaigns(): PastCampaign[] {
  const fromDrafts = listCampaignDrafts()
    .map(draftToPast)
    .filter((x): x is PastCampaign => x != null);

  const merged = [...fromDrafts, ...CATALOG];
  const seen = new Set<string>();
  const unique: PastCampaign[] = [];
  for (const c of merged) {
    const key = `${c.name}|${c.source}`;
    if (seen.has(key) || seen.has(c.id)) continue;
    seen.add(key);
    seen.add(c.id);
    unique.push(c);
  }

  return unique.sort(
    (a, b) =>
      new Date(b.completedAt).getTime() - new Date(a.completedAt).getTime(),
  );
}

export function listPastCampaignsForChannel(
  channelId: CampaignChannelId,
): PastCampaign[] {
  const label = channelLabel(channelId);
  return listPastCampaigns().filter((c) =>
    c.channels.some((ch) => ch.toLowerCase() === label.toLowerCase()),
  );
}
