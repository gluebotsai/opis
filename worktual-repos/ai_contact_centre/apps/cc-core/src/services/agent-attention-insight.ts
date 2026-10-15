import type { DbClient } from "../lib/rls.js";
import {
  buildAgentAttentionContext,
  type AgentAttentionClassification,
  type AgentAttentionContextPacket,
} from "./agent-attention-context.js";
import {
  getNotReadyEscalationById,
  updateNotReadyEscalationMetadata,
  type NotReadyEscalationRecord,
} from "./agent-not-ready-escalations.js";
import { emitMonitoringUpdated } from "./realtime.js";

const NLP_SERVICE_URL = process.env.NLP_SERVICE_URL ?? "http://localhost:8000";
const INTERNAL_SERVICE_KEY = process.env.INTERNAL_SERVICE_KEY;

export type AgentAttentionInsight = {
  classification: AgentAttentionClassification;
  classificationLabel: string;
  summary: string;
  suggestion: string;
  generatedAt: string;
  source: "nlp" | "rules";
  context: AgentAttentionContextPacket;
};

const CLASSIFICATION_LABELS: Record<AgentAttentionClassification, string> = {
  high_activity_not_ready: "High performer, extended Not Ready",
  low_activity_pattern: "Low activity pattern",
  repeat_escalation: "Repeat escalation",
  queue_pressure: "Queue pressure while Not Ready",
  possible_stuck: "Possibly stuck",
  isolated_incident: "Needs supervisor check-in",
};

function classificationLabel(classification: AgentAttentionClassification): string {
  return CLASSIFICATION_LABELS[classification];
}

function formatPresenceHours(seconds: Record<string, number>, state: string): string {
  const value = seconds[state] ?? 0;
  if (value <= 0) return "0m";
  const minutes = Math.round(value / 60);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  const remainder = minutes % 60;
  return remainder > 0 ? `${hours}h ${remainder}m` : `${hours}h`;
}

export function buildRuleBasedAgentAttentionInsight(
  context: AgentAttentionContextPacket,
): Pick<AgentAttentionInsight, "summary" | "suggestion"> {
  const { todayKpis, notReadyMinutes, queueNames, escalationsLast7Days } = context;
  const queueLabel = queueNames.length > 0 ? queueNames.slice(0, 2).join(", ") : "assigned queues";
  const notReadyLabel = `${notReadyMinutes} min`;
  const handledLabel = `${todayKpis.handled} handled today`;
  const notReadyToday = formatPresenceHours(context.presenceTodaySeconds, "not_ready");

  let summary = "";
  let suggestion = "";

  switch (context.classification) {
    case "high_activity_not_ready":
      summary = `${context.agentName} has ${handledLabel}${todayKpis.teamAvgHandled != null ? ` (team avg ${Math.round(todayKpis.teamAvgHandled)})` : ""} but has been Not Ready for ${notReadyLabel} with no active conversations.`;
      suggestion =
        "Check in for a short break or coaching—confirm whether they need queue relief after a strong workload stretch.";
      break;
    case "low_activity_pattern":
      summary = `${context.agentName} is below team pace (${handledLabel}) and has been Not Ready ${notReadyLabel} (${notReadyToday} in Not Ready today).`;
      suggestion =
        "Review blockers or training needs, then agree on a return-to-ready plan with a clear next action.";
      break;
    case "repeat_escalation":
      summary = `${context.agentName} triggered ${escalationsLast7Days} supervisor escalations in the last 7 days and is Not Ready again (${notReadyLabel}).`;
      suggestion =
        "Schedule a brief 1:1 to understand recurring friction and document a follow-up plan in the next shift.";
      break;
    case "queue_pressure":
      summary = `${context.agentName} is Not Ready (${notReadyLabel}) while ${context.queueWaitingTotal} customer${context.queueWaitingTotal === 1 ? "" : "s"} wait in ${queueLabel}.`;
      suggestion =
        "Prioritize a supervisor ping—offer a timed break if needed, or help them return Ready to protect service levels.";
      break;
    case "possible_stuck":
      summary = `${context.agentName} has only ${handledLabel} with ${notReadyLabel} Not Ready and limited activity signals today.`;
      suggestion =
        "Ask if they are blocked on a tool or personal issue; pair them with a buddy or supervisor until they are Ready again.";
      break;
    default:
      summary = `${context.agentName} has been Not Ready for ${notReadyLabel} (${handledLabel}, no active conversations).`;
      suggestion = "Send a quick check-in message and confirm when they expect to return Ready.";
      break;
  }

  return { summary, suggestion };
}

type NlpAgentAttentionInsightResponse = {
  summary: string;
  suggestion: string;
};

export async function fetchNlpAgentAttentionInsight(
  organizationId: string,
  context: AgentAttentionContextPacket,
): Promise<NlpAgentAttentionInsightResponse | null> {
  try {
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      Accept: "application/json",
      "x-tenant-id": organizationId,
    };
    if (INTERNAL_SERVICE_KEY) {
      headers["x-internal-service-key"] = INTERNAL_SERVICE_KEY;
    }

    const response = await fetch(
      `${NLP_SERVICE_URL}/internal/v1/supervisor/agent-attention-insight`,
      {
        method: "POST",
        headers,
        body: JSON.stringify({
          agentName: context.agentName,
          teamName: context.teamName,
          queueNames: context.queueNames,
          classification: context.classification,
          classificationLabel: classificationLabel(context.classification),
          classificationReasons: context.classificationReasons,
          notReadyMinutes: context.notReadyMinutes,
          activeConversations: context.activeConversations,
          attendanceToday: context.attendanceToday,
          todayKpis: context.todayKpis,
          presenceTodaySeconds: context.presenceTodaySeconds,
          escalationsLast7Days: context.escalationsLast7Days,
          queueWaitingTotal: context.queueWaitingTotal,
          escalatedAt: context.escalatedAt,
        }),
      },
    );
    if (!response.ok) return null;
    const payload = (await response.json()) as Partial<NlpAgentAttentionInsightResponse>;
    const summary = typeof payload.summary === "string" ? payload.summary.trim() : "";
    const suggestion = typeof payload.suggestion === "string" ? payload.suggestion.trim() : "";
    if (!summary || !suggestion) return null;
    return { summary, suggestion };
  } catch {
    return null;
  }
}

function parseStoredInsight(metadata: unknown): AgentAttentionInsight | null {
  if (!metadata || typeof metadata !== "object") return null;
  const insight = (metadata as { insight?: unknown }).insight;
  if (!insight || typeof insight !== "object") return null;
  const row = insight as Partial<AgentAttentionInsight>;
  if (
    typeof row.summary !== "string" ||
    typeof row.suggestion !== "string" ||
    typeof row.classification !== "string" ||
    typeof row.generatedAt !== "string"
  ) {
    return null;
  }
  return row as AgentAttentionInsight;
}

export async function generateAgentAttentionInsight(
  db: DbClient,
  organizationId: string,
  escalation: Pick<NotReadyEscalationRecord, "id" | "agentId" | "escalatedAt">,
): Promise<AgentAttentionInsight | null> {
  const context = await buildAgentAttentionContext(db, organizationId, escalation.agentId, {
    escalatedAt: escalation.escalatedAt,
  });
  if (!context) return null;

  const fallback = buildRuleBasedAgentAttentionInsight(context);
  const nlp = await fetchNlpAgentAttentionInsight(organizationId, context);
  const generatedAt = new Date().toISOString();
  const insight: AgentAttentionInsight = {
    classification: context.classification,
    classificationLabel: classificationLabel(context.classification),
    summary: nlp?.summary ?? fallback.summary,
    suggestion: nlp?.suggestion ?? fallback.suggestion,
    generatedAt,
    source: nlp ? "nlp" : "rules",
    context,
  };

  await updateNotReadyEscalationMetadata(db, organizationId, escalation.id, (metadata) => ({
    ...metadata,
    insight,
  }));
  emitMonitoringUpdated(organizationId, "agent.attention_insight_ready");
  return insight;
}

export async function getAgentAttentionInsight(
  db: DbClient,
  organizationId: string,
  escalationId: string,
  options?: { generateIfMissing?: boolean },
): Promise<AgentAttentionInsight | null> {
  const escalation = await getNotReadyEscalationById(db, organizationId, escalationId);
  if (!escalation) return null;

  const stored = parseStoredInsight(escalation.metadata);
  if (stored) return stored;
  if (!options?.generateIfMissing) return null;

  return generateAgentAttentionInsight(db, organizationId, escalation);
}
