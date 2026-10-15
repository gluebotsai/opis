/**
 * CRM bot handler for meeting-service POST /v1/assist/ask.
 */

import { prisma } from "@/dao/db/prisma";
import { getContact } from "@/dao/contacts/contact-service";
import {
  callAiServiceAgent,
  AI_SERVICE_JOB_TIMEOUT_MS,
} from "@/service/ai/ai-service-client";
import { buildAssistContextPack } from "@/service/ai/meeting-assist-context";
import { parseTopicFromMeetingBody } from "@/lib/meeting-body";
import { fetchMeetingServiceTranscript } from "@/service/meeting-service/client";
import { readCaptureBotMeta } from "@/service/transcripts/meeting-capture";
import { assistPersonaForUserId } from "@/service/meeting-assist/persona";
import {
  runMeetingAssist,
  type AssistResult,
} from "@/service/ai/meeting-assist";

export type MeetingServiceAssistAskBody = {
  meeting_id: string;
  organization_id: string;
  entity_type?: string | null;
  entity_id?: string | null;
  query: string;
  intent?: string | null;
  user?: {
    email?: string | null;
    crm_sub?: string | null;
    google_sub?: string | null;
  } | null;
  time_zone?: string | null;
};

function formatAssistReply(input: {
  talkTrack?: string | null;
  suggestions?: Array<{ text?: string }>;
  nextQuestions?: string[];
}): string {
  const parts: string[] = [];
  const track = (input.talkTrack || "").trim();
  if (track) parts.push(track);
  for (const s of input.suggestions || []) {
    const t = (s.text || "").trim();
    if (t) parts.push(t);
  }
  for (const q of input.nextQuestions || []) {
    const t = (q || "").trim();
    if (t) parts.push(t);
  }
  return parts.join("\n\n").trim() || "I don't have enough context yet — keep talking or ask again.";
}

export type MeetingServiceAssistAskResult = AssistResult & {
  reply: string;
};

function toAskPayload(
  result: AssistResult,
  query: string,
  persona: "sales" | "presales",
): MeetingServiceAssistAskResult {
  const replyParts = formatAssistReply({
    talkTrack: result.talkTrack,
    suggestions: result.suggestions,
    nextQuestions: result.nextQuestions,
  });
  const fitLines = (result.fitGaps || [])
    .map((g) => {
      const area = (g.area || "").trim();
      if (!area) return "";
      const note = (g.note || "").trim();
      return note ? `${area}: ${note}` : area;
    })
    .filter(Boolean);
  const reply =
    persona === "presales" && fitLines.length
      ? `${replyParts}\n\nFit / gap:\n${fitLines.join("\n")}`.trim()
      : replyParts;
  return { ...result, query: result.query || query, reply };
}

export async function handleMeetingServiceAssistAsk(
  body: MeetingServiceAssistAskBody,
  actorUserId: string,
): Promise<MeetingServiceAssistAskResult> {
  const query = (body.query || "").trim();
  if (!query) {
    return {
      ok: false,
      talkTrack: null,
      suggestions: [],
      objections: [],
      nextQuestions: [],
      sentiment: null,
      reason: "empty_query",
      reply: "Please enter a question.",
    };
  }

  const organizationId = String(body.organization_id || "").trim();
  const meetingId = String(body.meeting_id || "").trim();
  if (!organizationId || !meetingId) {
    return {
      ok: false,
      talkTrack: null,
      suggestions: [],
      objections: [],
      nextQuestions: [],
      sentiment: null,
      reason: "missing_meeting_context",
      reply: "Missing meeting context.",
    };
  }

  const sessions = await prisma.meetingAssistSession.findMany({
    where: { organizationId: BigInt(organizationId) },
    orderBy: { updatedAt: "desc" },
    take: 40,
    select: { id: true, activityId: true, meta: true, contactId: true, provider: true },
  });
  const sessionForSync = sessions.find(
    (s) => readCaptureBotMeta(s.meta)?.botId === meetingId,
  );
  if (sessionForSync?.activityId) {
    const { syncVexaLiveSegmentsForActivity } = await import(
      "@/service/meeting-service/vexa-live-assist-sync"
    );
    await syncVexaLiveSegmentsForActivity(sessionForSync.activityId).catch(
      () => ({ inserted: 0 }),
    );
  }

  const persona = (await assistPersonaForUserId(actorUserId)) ?? "sales";
  if (sessionForSync?.id) {
    const result = await runMeetingAssist({
      sessionId: sessionForSync.id,
      query,
      persona,
      viewerUserId: actorUserId,
      publishTargets: actorUserId ? [actorUserId] : [],
      interactive: true,
    });
    return toAskPayload(result, query, persona);
  }

  const transcript = await fetchMeetingServiceTranscript({
    organizationId,
    userId: actorUserId,
    meetingId,
  });
  const transcriptWindow = transcript.ok ? transcript.text : "";

  let contactId: string | null = null;
  let activityId: string | null = null;
  const entityType = (body.entity_type || "").trim().toLowerCase();
  const entityId = (body.entity_id || "").trim();

  const orgId = BigInt(organizationId);

  if (entityType === "contact" && entityId) {
    contactId = entityId;
  } else if (entityType === "deal" && entityId) {
    const deal = await prisma.deal.findFirst({
      where: { id: entityId, organizationId: orgId },
      select: { contactId: true },
    });
    contactId = deal?.contactId ?? null;
  }

  if (contactId) {
    const activity = await prisma.contactActivity.findFirst({
      where: {
        contactId,
        type: "meeting",
        organizationId: orgId,
      },
      orderBy: { dueAt: "desc" },
      select: { id: true },
    });
    activityId = activity?.id ?? null;
  }

  const session = await prisma.meetingAssistSession.findFirst({
    where: {
      organizationId: orgId,
      OR: [
        activityId ? { activityId } : undefined,
        contactId ? { contactId } : undefined,
      ].filter(Boolean) as Array<{ activityId: string } | { contactId: string }>,
    },
    orderBy: { updatedAt: "desc" },
    select: { id: true, contactId: true, activityId: true, provider: true },
  });

  if (session?.id) {
    const result = await runMeetingAssist({
      sessionId: session.id,
      query,
      persona,
      viewerUserId: actorUserId,
      publishTargets: actorUserId ? [actorUserId] : [],
      interactive: true,
      timeZone: body.time_zone,
    });
    return toAskPayload(result, query, persona);
  }

  const resolvedContactId = contactId || session?.contactId || null;
  const resolvedActivityId = activityId || session?.activityId || null;

  const [contact, activity, contextPack] = await Promise.all([
    resolvedContactId ? getContact(resolvedContactId) : Promise.resolve(null),
    resolvedActivityId
      ? prisma.contactActivity.findUnique({
          where: { id: resolvedActivityId },
          select: { subject: true, body: true },
        })
      : Promise.resolve(null),
    resolvedContactId && resolvedActivityId
      ? buildAssistContextPack({
          organizationId,
          contactId: resolvedContactId,
          activityId: resolvedActivityId,
        }).catch(() => null)
      : Promise.resolve(null),
  ]);

  const contactName =
    contact?.displayName ||
    [contact?.person.firstName, contact?.person.lastName]
      .filter(Boolean)
      .join(" ")
      .trim() ||
    null;
  const topic =
    parseTopicFromMeetingBody(activity?.body) ||
    activity?.subject?.replace(/^Meeting:\s*/i, "").trim() ||
    null;
  const companyName =
    contextPack?.company?.name || contact?.person.company?.name || null;

  const agent = await callAiServiceAgent<{
    ok?: boolean;
    talkTrack?: string | null;
    suggestions?: Array<{ text?: string }>;
    nextQuestions?: string[];
    fitGaps?: Array<{ area?: string; note?: string }>;
  }>(
    "assist-meeting",
    {
      query,
      transcriptWindow,
      persona,
      liveAssist: true,
      mode: "auto",
      contactId: resolvedContactId,
      contactName,
      companyName,
      provider: session?.provider || "google_meet",
      topic,
      organizationId,
      timeZone: body.time_zone,
      contextPack: contextPack
        ? {
            packText: contextPack.packText,
            contact: contextPack.contact,
            company: contextPack.company,
            score: contextPack.score,
            primaryDeal: contextPack.primaryDeal,
            recentActivity: contextPack.recentActivity,
            leadSummary: contextPack.leadSummary,
            enrichmentHints: contextPack.enrichmentHints,
            products: contextPack.products,
          }
        : null,
    },
    { timeoutMs: AI_SERVICE_JOB_TIMEOUT_MS },
  );

  const replyParts = formatAssistReply({
    talkTrack: agent?.talkTrack,
    suggestions: agent?.suggestions,
    nextQuestions: agent?.nextQuestions,
  });
  const fitLines = (agent?.fitGaps || [])
    .map((g) => {
      const area = (g.area || "").trim();
      if (!area) return "";
      const note = (g.note || "").trim();
      return note ? `${area}: ${note}` : area;
    })
    .filter(Boolean);
  const reply =
    persona === "presales" && fitLines.length
      ? `${replyParts}\n\nFit / gap:\n${fitLines.join("\n")}`.trim()
      : replyParts;

  return {
    ok: Boolean(agent?.ok),
    talkTrack: agent?.talkTrack ?? null,
    suggestions: Array.isArray(agent?.suggestions) ? agent!.suggestions! : [],
    objections: [],
    nextQuestions: Array.isArray(agent?.nextQuestions)
      ? agent!.nextQuestions!
      : [],
    sentiment: null,
    query,
    reply,
  };
}
