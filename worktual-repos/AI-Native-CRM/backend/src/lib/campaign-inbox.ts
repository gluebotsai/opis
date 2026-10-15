/**
 * Campaign Inbox — only human-in-the-loop / bot-replied threads
 * for launched campaigns (Phase 1 seeded preview data).
 */

import type { CampaignChannelId } from "@/lib/campaign-channels";

export type CampaignInboxHandler = "human_needed" | "bot_replied";

export type CampaignInboxMessage = {
  id: string;
  role: "contact" | "bot" | "agent" | "system";
  text: string;
  createdAt: string;
};

export type CampaignInboxThread = {
  id: string;
  channel: CampaignChannelId;
  campaignId: string;
  campaignName: string;
  contactName: string;
  contactHandle: string;
  handler: CampaignInboxHandler;
  updatedAt: string;
  preview: string;
  messages: CampaignInboxMessage[];
  /** Unsent reply body — appears under Drafts folder */
  draftReply: string;
  /** Outlook-style unread highlight */
  unread: boolean;
};

function hoursAgo(h: number): string {
  return new Date(Date.now() - h * 60 * 60 * 1000).toISOString();
}

const STORAGE_KEY = "worktual.campaignInbox.v2";

function canUseStorage() {
  return typeof window !== "undefined" && typeof localStorage !== "undefined";
}

function withDefaults(
  t: Omit<CampaignInboxThread, "draftReply" | "unread"> & {
    draftReply?: string;
    unread?: boolean;
  },
): CampaignInboxThread {
  return {
    ...t,
    draftReply: t.draftReply ?? "",
    unread: t.unread ?? true,
  };
}

const SEED: Array<Omit<CampaignInboxThread, "draftReply" | "unread"> & { unread?: boolean }> = [
  {
    id: "cin-1",
    channel: "email",
    campaignId: "camp-festive",
    campaignName: "Festival sale blast",
    contactName: "Priya Sharma",
    contactHandle: "priya.sharma@example.com",
    handler: "human_needed",
    updatedAt: hoursAgo(2),
    preview: "Is COD available for this offer?",
    unread: true,
    messages: [
      {
        id: "m1",
        role: "system",
        text: "Campaign email sent: Festival sale blast",
        createdAt: hoursAgo(28),
      },
      {
        id: "m2",
        role: "contact",
        text: "Hi, I got your festival offer. Is COD available for this offer?",
        createdAt: hoursAgo(2),
      },
    ],
  },
  {
    id: "cin-2",
    channel: "whatsapp",
    campaignId: "camp-cart",
    campaignName: "Cart recovery WA",
    contactName: "Rahul Mehta",
    contactHandle: "+91 98765 43210",
    handler: "human_needed",
    updatedAt: hoursAgo(5),
    preview: "Can you hold the items until Friday?",
    unread: true,
    messages: [
      {
        id: "m1",
        role: "system",
        text: "WhatsApp template sent: cart_recovery_en",
        createdAt: hoursAgo(30),
      },
      {
        id: "m2",
        role: "contact",
        text: "Thanks for the reminder. Can you hold the items until Friday?",
        createdAt: hoursAgo(5),
      },
    ],
  },
  {
    id: "cin-3",
    channel: "sms",
    campaignId: "camp-festive",
    campaignName: "Festival sale blast",
    contactName: "Ananya Rao",
    contactHandle: "+91 99887 66554",
    handler: "bot_replied",
    updatedAt: hoursAgo(8),
    preview: "Bot: Sale ends Sunday — reply HELP for store locator.",
    unread: false,
    messages: [
      {
        id: "m1",
        role: "system",
        text: "SMS sent via DLT template PROMO_SALE_12",
        createdAt: hoursAgo(36),
      },
      {
        id: "m2",
        role: "contact",
        text: "When does the sale end?",
        createdAt: hoursAgo(9),
      },
      {
        id: "m3",
        role: "bot",
        text: "Sale ends Sunday midnight. Reply HELP for store locator, or STOP to opt out.",
        createdAt: hoursAgo(8),
      },
    ],
  },
  {
    id: "cin-4",
    channel: "whatsapp",
    campaignId: "camp-webinar",
    campaignName: "Webinar invite sequence",
    contactName: "Vikram Patel",
    contactHandle: "+91 91234 56789",
    handler: "bot_replied",
    updatedAt: hoursAgo(12),
    preview: "Bot: You’re registered — calendar link sent.",
    unread: false,
    messages: [
      {
        id: "m1",
        role: "system",
        text: "WhatsApp invite sent for Product webinar",
        createdAt: hoursAgo(48),
      },
      {
        id: "m2",
        role: "contact",
        text: "Please register me for the webinar.",
        createdAt: hoursAgo(13),
      },
      {
        id: "m3",
        role: "bot",
        text: "You’re registered. Calendar link: https://example.com/webinar",
        createdAt: hoursAgo(12),
      },
    ],
  },
  {
    id: "cin-5",
    channel: "email",
    campaignId: "camp-weekend",
    campaignName: "Weekend flash deal",
    contactName: "Sneha Iyer",
    contactHandle: "sneha.iyer@example.com",
    handler: "human_needed",
    updatedAt: hoursAgo(1),
    preview: "Need invoice for last purchase before I buy again.",
    unread: true,
    messages: [
      {
        id: "m1",
        role: "system",
        text: "Campaign email sent: Weekend flash deal",
        createdAt: hoursAgo(20),
      },
      {
        id: "m2",
        role: "contact",
        text: "I like the deal but need the invoice for my last purchase before I buy again.",
        createdAt: hoursAgo(1),
      },
    ],
  },
  {
    id: "cin-6",
    channel: "app_push",
    campaignId: "camp-restock",
    campaignName: "Restock alert campaign",
    contactName: "Arjun Nair",
    contactHandle: "app:user_88421",
    handler: "human_needed",
    updatedAt: hoursAgo(3),
    preview: "Wrong size restocked — can you notify for M?",
    unread: true,
    messages: [
      {
        id: "m1",
        role: "system",
        text: "App push sent: restock alert",
        createdAt: hoursAgo(10),
      },
      {
        id: "m2",
        role: "contact",
        text: "You restocked the wrong size. Can you notify me when size M is back?",
        createdAt: hoursAgo(3),
      },
    ],
  },
];

export function listCampaignInboxThreads(): CampaignInboxThread[] {
  const seeded = SEED.map((t) => withDefaults(t));
  if (!canUseStorage()) return seeded;

  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) {
      writeThreads(seeded);
      return seeded;
    }
    const parsed = JSON.parse(raw) as CampaignInboxThread[];
    if (!Array.isArray(parsed) || parsed.length === 0) {
      writeThreads(seeded);
      return seeded;
    }
    return parsed
      .map((t) => withDefaults(t))
      .sort(
        (a, b) =>
          new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime(),
      );
  } catch {
    return seeded;
  }
}

function writeThreads(threads: CampaignInboxThread[]) {
  if (!canUseStorage()) return;
  localStorage.setItem(STORAGE_KEY, JSON.stringify(threads));
}

export function saveCampaignInboxThreads(threads: CampaignInboxThread[]) {
  writeThreads(threads);
}

export function formatInboxTime(iso: string): string {
  const t = new Date(iso).getTime();
  const diff = Date.now() - t;
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "Just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  if (days < 7) return `${days}d ago`;
  return new Date(iso).toLocaleDateString();
}

export function threadHasDraft(t: CampaignInboxThread): boolean {
  return t.draftReply.trim().length > 0;
}

export function threadHasSent(t: CampaignInboxThread): boolean {
  return t.messages.some((m) => m.role === "agent");
}
