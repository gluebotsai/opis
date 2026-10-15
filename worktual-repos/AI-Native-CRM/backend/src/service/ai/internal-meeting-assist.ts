/**
 * Internal meeting turns. TypeScript picks the audience and publishes
 * per viewer. The answer and the fact verdict come from the Python agent.
 */

import { isMicOrLocalSttSource } from "@/lib/meeting-assist-speakers";
import {
  isInternalEmployee,
  isInternalManager,
  matchInternalSpeaker,
  planInternalDelivery,
  type InternalPerson,
  type InternalTargetType,
  type InternalTopic,
} from "@/lib/internal-meeting";
import { callAiServiceAgent } from "@/service/ai/ai-service-client";
import { publishMeetingAssistEvent } from "@/service/ai/meeting-assist-events";
import {
  contextRoleFor,
  loadEmployeeMeetingContext,
} from "@/service/ai/internal-meeting-context";
import { logMeetAssistPanel } from "@/service/ai/meeting-assist-panel-log";
import { loadInternalRoster } from "@/service/ai/internal-meeting-roster";
import {
  claimPendingInternalQuestion,
  clearPendingInternalQuestions,
  getPendingInternalQuestion,
  savePendingInternalQuestion,
} from "@/service/ai/internal-meeting-question-store";
import { getActiveMeetingAssistViewerIds } from "@/service/meeting-assist/active-viewers";

const LIVE_TIMEOUT_MS = 25_000;

type RouteResult = {
  source?: string;
  reason?: string;
  isQuestion?: boolean;
  targetType?: string;
  addresseeName?: string | null;
  topic?: string;
};

type AnswerResult = { source?: string; reason?: string; answer?: string };
type FactResult = {
  source?: string;
  reason?: string;
  isAnswer?: boolean;
  verdict?: string;
  detail?: string;
};

const pending = new Map<string, ReturnType<typeof setTimeout>>();

function asTopic(value: string | undefined): InternalTopic {
  if (
    value === "sales" ||
    value === "presales" ||
    value === "marketing" ||
    value === "finance" ||
    value === "support"
  ) {
    return value;
  }
  return "unclear";
}

function asTargetType(
  value: string | undefined,
  addresseeName: string | null | undefined,
  topic: InternalTopic,
): InternalTargetType {
  if (addresseeName?.trim()) return "person";
  if (value === "person" || value === "team" || value === "general") return value;
  return topic === "unclear" ? "general" : "team";
}

function emptyAssist() {
  return {
    ok: true,
    talkTrack: null,
    suggestions: [],
    objections: [],
    nextQuestions: [],
    nextBestAction: null,
    sentiment: null,
    query: null,
  };
}

export function scheduleInternalMeetingAssist(input: {
  sessionId: string;
  text: string;
  speaker?: string | null;
  speakerEmail?: string | null;
  source?: string | null;
}): void {
  const text = input.text.trim();
  if (!text || isMicOrLocalSttSource(input.source)) return;
  const sessionId = input.sessionId.trim();
  const existing = pending.get(sessionId);
  if (existing) clearTimeout(existing);
  pending.set(
    sessionId,
    setTimeout(() => {
      pending.delete(sessionId);
      void runInternalTurn({
        sessionId,
        text,
        speaker: input.speaker,
        speakerEmail: input.speakerEmail,
      }).catch((err) => {
        console.error("internal meeting assist failed", err);
      });
    }, 200),
  );
}

export function clearInternalMeetingAssist(sessionId: string): void {
  const timer = pending.get(sessionId);
  if (timer) clearTimeout(timer);
  pending.delete(sessionId);
  clearPendingInternalQuestions(sessionId);
}

async function runInternalTurn(input: {
  sessionId: string;
  text: string;
  speaker?: string | null;
  speakerEmail?: string | null;
}): Promise<void> {
  const roster = await loadInternalRoster(input.sessionId);
  if (!roster || roster.kind !== "internal") return;
  const speaker = matchInternalSpeaker(roster.people, input.speaker, input.speakerEmail);
  if (!speaker) {
    logMeetAssistPanel("internal_speaker_unmatched", {
      sessionId: input.sessionId,
      speaker: input.speaker ?? null,
      speakerEmail: input.speakerEmail ?? null,
      rosterSize: roster.people.length,
    });
    return;
  }

  const heardLine = `${speaker.name}: ${input.text}`;
  if (
    isInternalEmployee(speaker) &&
    !isInternalManager(speaker, roster.overrideEmails)
  ) {
    const pendingQuestion = await getPendingInternalQuestion(
      input.sessionId,
      speaker.userId,
    );
    if (!pendingQuestion) return;
    const manager = roster.people.find(
      (person) =>
        person.userId === pendingQuestion.askerUserId &&
        isInternalManager(person, roster.overrideEmails),
    );
    if (!manager) return;
    const role = contextRoleFor(speaker.role);
    const context = await loadEmployeeMeetingContext({
      organizationId: roster.organizationId,
      userId: speaker.userId,
      name: speaker.name,
      role,
    });
    const fact = await callAiServiceAgent<FactResult>(
      "assist-internal-meeting",
      {
        task: "fact",
        utterance: input.text,
        question: pendingQuestion.question,
        role,
        context,
        organizationId: roster.organizationId,
      },
      { timeoutMs: LIVE_TIMEOUT_MS },
    );
    if (fact?.source !== "ai" || fact.isAnswer !== true) {
      logMeetAssistPanel("internal_assist_llm_skipped", {
        sessionId: input.sessionId,
        task: "fact",
        source: fact?.source ?? null,
        reason: fact?.reason ?? null,
        isAnswer: fact?.isAnswer ?? null,
      });
      return;
    }
    const claimed = await claimPendingInternalQuestion(
      input.sessionId,
      speaker.userId,
    );
    if (!claimed || claimed.createdAt !== pendingQuestion.createdAt) return;
    const verdict =
      fact.verdict === "matches" || fact.verdict === "differs" || fact.verdict === "unknown"
        ? fact.verdict
        : "unknown";
    logMeetAssistPanel("internal_assist_publish", {
      sessionId: input.sessionId,
      viewerId: manager.userId,
      audience: "manager",
    });
    publishMeetingAssistEvent(
      input.sessionId,
      {
        type: "assist",
        result: {
          ...emptyAssist(),
          internal: true,
          audience: "manager",
          factVerdict: verdict,
          factDetail: fact.detail || null,
          heardLine,
        },
      },
      { viewerId: manager.userId },
    );
    return;
  }

  if (!isInternalManager(speaker, roster.overrideEmails)) return;

  const route = await callAiServiceAgent<RouteResult>(
    "assist-internal-meeting",
    {
      task: "route",
      utterance: input.text,
      organizationId: roster.organizationId,
    },
    { timeoutMs: LIVE_TIMEOUT_MS },
  );
  const topic = asTopic(route?.topic);
  const delivery = planInternalDelivery({
    speaker,
    isQuestion: route?.source === "ai" && Boolean(route.isQuestion),
    targetType: asTargetType(
      route?.targetType,
      route?.addresseeName,
      topic,
    ),
    addresseeName: route?.addresseeName ?? null,
    topic,
    people: roster.people,
    overrideEmails: roster.overrideEmails,
  });
  if (delivery.kind !== "answer") {
    logMeetAssistPanel("internal_assist_no_delivery", {
      sessionId: input.sessionId,
      speakerUserId: speaker.userId,
      source: route?.source ?? null,
      reason: route?.reason ?? null,
      isQuestion: route?.isQuestion ?? null,
      targetType: route?.targetType ?? null,
      addresseeName: route?.addresseeName ?? null,
      topic: route?.topic ?? null,
    });
    return;
  }
  const recipients = panelsInCall(input.sessionId, delivery.recipients);
  if (!recipients.length) return;
  await savePendingInternalQuestion({
    sessionId: input.sessionId,
    askerUserId: speaker.userId,
    askerName: speaker.name,
    question: input.text,
    employeeUserIds: recipients.map((person) => person.userId),
  });

  await Promise.all(
    recipients.map(async (person) => {
      const role = contextRoleFor(person.role);
      const context = await loadEmployeeMeetingContext({
        organizationId: roster.organizationId,
        userId: person.userId,
        name: person.name,
        role,
      });
      const answer = await callAiServiceAgent<AnswerResult>(
        "assist-internal-meeting",
        {
          task: "answer",
          utterance: input.text,
          role,
          context,
          organizationId: roster.organizationId,
        },
        { timeoutMs: LIVE_TIMEOUT_MS },
      );
      const text = answer?.source === "ai" ? (answer.answer || "").trim() : "";
      if (!text) {
        logMeetAssistPanel("internal_assist_llm_skipped", {
          sessionId: input.sessionId,
          task: "answer",
          viewerId: person.userId,
          source: answer?.source ?? null,
          reason: answer?.reason ?? null,
        });
        return;
      }
      logMeetAssistPanel("internal_assist_publish", {
        sessionId: input.sessionId,
        viewerId: person.userId,
        audience: "employee",
      });
      publishMeetingAssistEvent(
        input.sessionId,
        {
          type: "assist",
          result: {
            ...emptyAssist(),
            internal: true,
            audience: "employee",
            answer: text,
            heardLine,
          },
        },
        { viewerId: person.userId },
      );
    }),
  );
}

/** A Meet attendee is represented by their authenticated, open panel. */
function panelsInCall(sessionId: string, recipients: InternalPerson[]): InternalPerson[] {
  const open = new Set(getActiveMeetingAssistViewerIds(sessionId));
  return recipients.filter((person) => open.has(person.userId));
}
