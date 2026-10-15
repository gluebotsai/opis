import { getContact } from "@/dao/contacts/contact-service";
import { prisma } from "@/dao/db/prisma";
import {
  parseMeetingLinkFromBody,
  parseProviderFromMeetingBody,
  parseTopicFromMeetingBody,
} from "@/lib/meeting-body";
import {
  getMeetingAssistSessionForActivity,
  startMeetingAssistSession,
} from "@/service/ai/meeting-assist";
import type { MeetingProvider } from "@/lib/meeting-provider";

export type HostMeetingRow = {
  activityId: string;
  contactId: string;
  contactName: string;
  subject: string;
  topic: string | null;
  joinUrl: string | null;
  meetCode: string | null;
  provider: string;
  dueAt: string | null;
  sessionId: string | null;
};

function extractMeetCode(url: string | null): string | null {
  if (!url) return null;
  const m = url.match(/meet\.google\.com\/([a-z0-9-]+)/i);
  return m?.[1]?.toLowerCase() ?? null;
}

function matchesProviderFilter(
  provider: string,
  filter: MeetingProvider | "all",
): boolean {
  if (filter === "all") return true;
  return provider === filter;
}

/**
 * Recent CRM meetings the host user can link from an in-meeting side panel.
 */
export async function listHostMeetingsForUser(input: {
  userId: string;
  provider?: MeetingProvider | "all";
  limit?: number;
}): Promise<HostMeetingRow[]> {
  const limit = Math.min(Math.max(input.limit ?? 12, 1), 30);
  const filter = input.provider ?? "all";

  const activities = await prisma.contactActivity.findMany({
    where: {
      type: "meeting",
      OR: [
        { createdByUserId: input.userId },
        ...(filter === "google_meet" || filter === "all"
          ? [{ body: { contains: "meet.google.com" } }]
          : []),
        ...(filter === "zoom" || filter === "all"
          ? [{ body: { contains: "zoom.us" } }]
          : []),
        ...(filter === "teams" || filter === "all"
          ? [{ body: { contains: "teams.microsoft.com" } }]
          : []),
      ],
    },
    orderBy: [{ dueAt: "desc" }, { createdAt: "desc" }],
    take: 40,
    select: {
      id: true,
      contactId: true,
      subject: true,
      body: true,
      dueAt: true,
      createdByUserId: true,
    },
  });

  const meetings: HostMeetingRow[] = [];

  for (const a of activities) {
    const joinUrl = parseMeetingLinkFromBody(a.body);
    const provider = parseProviderFromMeetingBody(a.body);
    if (!matchesProviderFilter(provider, filter)) continue;

    if (a.createdByUserId !== input.userId) {
      const contact = await getContact(a.contactId);
      const ownerId =
        contact?.person.ownerUserId || contact?.crm.ownerUserId || null;
      if (ownerId !== input.userId) continue;
    }

    const contact = await getContact(a.contactId);
    const session = await getMeetingAssistSessionForActivity(a.id);
    meetings.push({
      activityId: a.id,
      contactId: a.contactId,
      contactName: contact?.displayName || "Contact",
      subject: a.subject,
      topic: parseTopicFromMeetingBody(a.body),
      joinUrl,
      meetCode: extractMeetCode(joinUrl),
      provider,
      dueAt: a.dueAt?.toISOString() ?? null,
      sessionId: session?.id ?? null,
    });
    if (meetings.length >= limit) break;
  }

  return meetings;
}

export async function startAssistFromActivityForHost(input: {
  userId: string;
  activityId: string;
  externalMeetingId?: string | null;
}): Promise<
  | {
      ok: true;
      sessionId: string;
      contactId: string;
      contactName: string;
      topic: string | null;
      joinUrl: string | null;
      provider: string;
    }
  | { ok: false; error: string }
> {
  const activity = await prisma.contactActivity.findUnique({
    where: { id: input.activityId },
    select: {
      id: true,
      contactId: true,
      subject: true,
      body: true,
      type: true,
    },
  });
  if (!activity || activity.type !== "meeting") {
    return { ok: false, error: "Meeting not found." };
  }

  const started = await startMeetingAssistSession({
    activityId: activity.id,
    hostUserId: input.userId,
    provider: parseProviderFromMeetingBody(activity.body),
    joinUrl: parseMeetingLinkFromBody(activity.body),
    externalMeetingId: input.externalMeetingId,
  });
  if (!started.ok) return { ok: false, error: started.error };

  const contact = await getContact(activity.contactId);
  return {
    ok: true,
    sessionId: started.sessionId,
    contactId: activity.contactId,
    contactName: contact?.displayName || "Contact",
    topic:
      parseTopicFromMeetingBody(activity.body) ||
      activity.subject.replace(/^Meeting:\s*/i, "").trim() ||
      null,
    joinUrl: parseMeetingLinkFromBody(activity.body),
    provider: parseProviderFromMeetingBody(activity.body),
  };
}

export async function resolveMeetCodeForHost(input: {
  userId: string;
  meetCode: string;
}): Promise<
  | {
      ok: true;
      activityId: string;
      contactId: string;
      sessionId: string;
      contactName: string;
      topic: string | null;
      joinUrl: string | null;
    }
  | { ok: false; error: string }
> {
  const code = input.meetCode
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\/meet\.google\.com\//, "")
    .replace(/\s+/g, "");
  if (!code) return { ok: false, error: "Enter a Meet code." };

  const compact = code.replace(/-/g, "");

  const activities = await prisma.contactActivity.findMany({
    where: {
      type: "meeting",
      OR: [
        { body: { contains: code } },
        { body: { contains: `meet.google.com/${code}` } },
      ],
    },
    orderBy: { createdAt: "desc" },
    take: 20,
    select: {
      id: true,
      contactId: true,
      subject: true,
      body: true,
      createdByUserId: true,
    },
  });

  const filtered = activities.filter((a) => {
    const body = (a.body || "").toLowerCase();
    if (body.includes(code)) return true;
    const found = body.match(/meet\.google\.com\/([a-z0-9-]+)/i);
    if (found?.[1]?.replace(/-/g, "") === compact) return true;
    return false;
  });

  const activity =
    filtered.find((a) => a.createdByUserId === input.userId) ||
    filtered[0] ||
    null;

  if (!activity) {
    return {
      ok: false,
      error:
        "No CRM meeting found for that Meet code. Schedule Google Meet from a contact first.",
    };
  }

  return startAssistFromActivityForHost({
    userId: input.userId,
    activityId: activity.id,
    externalMeetingId: code,
  }).then((started) => {
    if (!started.ok) return started;
    return {
      ok: true as const,
      activityId: activity.id,
      contactId: started.contactId,
      sessionId: started.sessionId,
      contactName: started.contactName,
      topic: started.topic,
      joinUrl: started.joinUrl,
    };
  });
}
