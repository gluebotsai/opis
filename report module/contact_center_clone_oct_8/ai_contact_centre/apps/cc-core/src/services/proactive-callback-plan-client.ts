import { z } from "zod";

const NLP_URL = (process.env.NLP_SERVICE_URL ?? "http://localhost:8000").replace(/\/$/, "");
const INTERNAL_SERVICE_KEY = process.env.INTERNAL_SERVICE_KEY;

export const proactivePlanRequestSchema = z.object({
  organizationId: z.string().min(1),
  missedContactId: z.string().min(1),
  conversationId: z.string().nullable(),
  contactId: z.string().nullable(),
  queueId: z.string().nullable(),
  channel: z.string().min(1),
  reason: z.string().min(1),
  missedAt: z.string().datetime(),
  customerName: z.string().nullable(),
  queueName: z.string().nullable(),
  queueDescription: z.string().nullable(),
  queueSkills: z.array(z.string()),
  eligibleAgents: z.array(
    z.object({
      setupUserId: z.string(),
      agentId: z.string(),
      displayName: z.string(),
      skills: z.array(z.string()),
      openCallbackCount: z.number().int().nonnegative(),
      skillScore: z.number().int().nonnegative(),
    }),
  ),
  queueCloseTime: z.string().nullable(),
});

export type ProactivePlanRequest = z.infer<typeof proactivePlanRequestSchema>;

export const proactivePlanResponseSchema = z.union([
  z.object({
    skip: z.literal(true),
    reason: z.string(),
  }),
  z.object({
    assignedUserId: z.string().min(1),
    dueAt: z.string().datetime(),
    priority: z.enum(["low", "normal", "high", "critical"]).default("normal"),
    channel: z.enum(["whatsapp", "instagram", "facebook", "email"]),
    title: z.string().min(1).max(200),
    summary: z.string().min(1).max(2000),
    notes: z.string().max(4000).optional(),
    confidence: z.enum(["high", "medium", "low"]).optional(),
  }),
]);

export type ProactivePlanResponse = z.infer<typeof proactivePlanResponseSchema>;

export async function requestProactiveCallbackPlan(
  payload: ProactivePlanRequest,
): Promise<ProactivePlanResponse> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    "X-Tenant-Id": payload.organizationId,
  };
  if (INTERNAL_SERVICE_KEY) {
    headers["X-Internal-Service-Key"] = INTERNAL_SERVICE_KEY;
  }

  const response = await fetch(`${NLP_URL}/api/v1/proactive/missed-callback/plan`, {
    method: "POST",
    headers,
    body: JSON.stringify({
      organization_id: payload.organizationId,
      missed_contact_id: payload.missedContactId,
      conversation_id: payload.conversationId,
      contact_id: payload.contactId,
      queue_id: payload.queueId,
      channel: payload.channel,
      reason: payload.reason,
      missed_at: payload.missedAt,
      customer_name: payload.customerName,
      queue_name: payload.queueName,
      queue_description: payload.queueDescription,
      queue_skills: payload.queueSkills,
      eligible_agents: payload.eligibleAgents.map((agent) => ({
        setup_user_id: agent.setupUserId,
        agent_id: agent.agentId,
        display_name: agent.displayName,
        skills: agent.skills,
        open_callback_count: agent.openCallbackCount,
        skill_score: agent.skillScore,
      })),
      queue_close_time: payload.queueCloseTime,
    }),
    signal: AbortSignal.timeout(Number(process.env.PROACTIVE_CALLBACK_NLP_TIMEOUT_MS ?? 30_000)),
  });

  if (!response.ok) {
    throw new Error(`Proactive plan request failed (${response.status})`);
  }

  const body: unknown = await response.json();
  return proactivePlanResponseSchema.parse(body);
}

export function deterministicProactivePlan(
  payload: ProactivePlanRequest,
): ProactivePlanResponse {
  if (payload.eligibleAgents.length === 0) {
    return { skip: true, reason: "No eligible agents available" };
  }

  const sorted = [...payload.eligibleAgents].sort((left, right) => {
    if (right.skillScore !== left.skillScore) return right.skillScore - left.skillScore;
    if (left.openCallbackCount !== right.openCallbackCount) {
      return left.openCallbackCount - right.openCallbackCount;
    }
    return left.agentId.localeCompare(right.agentId);
  });
  const picked = sorted[0];
  if (!picked) {
    return { skip: true, reason: "No eligible agents available" };
  }

  const now = new Date();
  const dueAt = new Date(now.getTime() + 4 * 60 * 60 * 1000);
  const channel = payload.channel.trim().toLowerCase();
  if (channel === "webchat" || channel === "chat" || channel === "voice") {
    return {
      skip: true,
      reason: "Missed channel is not callback-eligible without a reachable outreach identity",
    };
  }
  if (
    channel !== "whatsapp" &&
    channel !== "instagram" &&
    channel !== "facebook" &&
    channel !== "email"
  ) {
    return {
      skip: true,
      reason: `Unsupported callback channel: ${payload.channel}`,
    };
  }
  const outreachChannel = channel;

  return {
    assignedUserId: picked.setupUserId,
    dueAt: dueAt.toISOString(),
    priority: "normal",
    channel: outreachChannel,
    title: `Callback · ${outreachChannel.charAt(0).toUpperCase()}${outreachChannel.slice(1)}`,
    summary: `Co-worker assigned callback after missed contact in ${payload.queueName ?? "queue"}.`,
    notes: `Picked ${picked.displayName}: skill score ${picked.skillScore}, ${picked.openCallbackCount} open callbacks.`,
    confidence: "medium",
  };
}
