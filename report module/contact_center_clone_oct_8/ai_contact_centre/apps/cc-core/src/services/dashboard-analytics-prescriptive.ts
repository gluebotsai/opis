import type { DbClient } from "../lib/rls.js";
import { serializeEntityIdOptional } from "../lib/id-schema.js";
import {
  DASHBOARD_ANALYTICS_SCHEMA_VERSION,
  hashInput,
  startOfUtcDay,
} from "./dashboard-analytics-math.js";
import { fetchWorkforcePlan } from "./dashboard-analytics-nlp.js";
import type { StoredForecastRun } from "./dashboard-analytics-storage.js";
import {
  getLatestWorkforcePlan,
  saveWorkforcePlan,
} from "./dashboard-analytics-storage.js";
import type {
  DiagnosticIncidentRecord,
  PrescriptiveAnalytics,
  PrescriptiveRecommendation,
  PredictiveAnalytics,
} from "./dashboard-analytics-types.js";

type QueueMemberRow = {
  queue_id: string;
  queue_name: string;
  channel: string;
  agent_id: string;
  display_name: string;
  presence_state: string | null;
};

type QueueRequirement = {
  queueId: string;
  queueName: string;
  channel: string;
  window: string;
  expectedContacts: number;
  currentMemberCount: number;
  requiredMemberCount: number;
  allowedAddCount: number;
  currentMemberIds: string[];
  eligibleAgents: Array<{
    agentId: string;
    displayName: string;
    skills: string[];
    channels: string[];
    shiftAvailable: boolean;
    availableCapacity: number;
  }>;
};

const TARGET_OCCUPANCY = 0.8;
const DEFAULT_AHT_SECONDS = 360;
const TARGET_INTERVAL_SECONDS = 3_600;

function emptyPrescriptive(): PrescriptiveAnalytics {
  return {
    decision: "no_change",
    planId: null,
    forecastVersion: null,
    recommendations: [],
    source: "rules",
  };
}

async function loadQueueMembers(db: DbClient, organizationId: string): Promise<QueueMemberRow[]> {
  return db.$queryRawUnsafe<QueueMemberRow[]>(
    `
    SELECT
      q.id::text AS queue_id,
      q.name AS queue_name,
      COALESCE(channel_stats.channel, 'webchat') AS channel,
      a.id::text AS agent_id,
      a.display_name,
      ap.presence_state
    FROM ccass.queues q
    INNER JOIN ccass.queue_members qm
      ON qm.queue_id = q.id
    INNER JOIN ccass.agents a
      ON a.id = qm.agent_id
     AND a.organization_id = q.organization_id
    LEFT JOIN ccass.agent_presence ap
      ON ap.agent_id = a.id
     AND ap.organization_id = a.organization_id
    LEFT JOIN LATERAL (
      SELECT c.channel
      FROM ccass.conversations c
      WHERE c.organization_id = q.organization_id
        AND c.queue_id = q.id
      GROUP BY c.channel
      ORDER BY COUNT(*) DESC
      LIMIT 1
    ) channel_stats ON TRUE
    WHERE q.organization_id = $1::bigint
      AND q.status = 'active'
    ORDER BY q.name ASC, a.display_name ASC
    `,
    organizationId,
  );
}

async function loadEligibleAgents(db: DbClient, organizationId: string) {
  return db.$queryRawUnsafe<
    Array<{
      agent_id: string;
      display_name: string;
      skills: unknown;
      channels: unknown;
      presence_state: string | null;
    }>
  >(
    `
    SELECT
      a.id::text AS agent_id,
      a.display_name,
      su.skills,
      su.shift_types AS channels,
      ap.presence_state
    FROM ccass.agents a
    LEFT JOIN accounts.setup_users su
      ON su.id = a.setup_user_id
    LEFT JOIN ccass.agent_presence ap
      ON ap.agent_id = a.id
     AND ap.organization_id = a.organization_id
    WHERE a.organization_id = $1::bigint
      AND a.status = 'active'
    ORDER BY a.display_name ASC
    `,
    organizationId,
  );
}

function calculateRequiredAgents(expectedContacts: number, ahtSeconds = DEFAULT_AHT_SECONDS): number {
  const workloadSeconds = expectedContacts * ahtSeconds;
  const concurrentCapacity = workloadSeconds / TARGET_INTERVAL_SECONDS;
  return Math.max(1, Math.ceil(concurrentCapacity / TARGET_OCCUPANCY));
}

function buildQueueRequirements(
  members: QueueMemberRow[],
  eligibleAgents: Awaited<ReturnType<typeof loadEligibleAgents>>,
  predictive: PredictiveAnalytics,
  incident: DiagnosticIncidentRecord | null,
): QueueRequirement[] {
  const byQueue = new Map<string, QueueMemberRow[]>();
  for (const member of members) {
    const list = byQueue.get(member.queue_id) ?? [];
    list.push(member);
    byQueue.set(member.queue_id, list);
  }

  const requirements: QueueRequirement[] = [];
  for (const [queueId, queueMembers] of byQueue.entries()) {
    const queueName = queueMembers[0]?.queue_name ?? `Queue ${queueId}`;
    const channel = queueMembers[0]?.channel ?? "webchat";
    const expectedContacts =
      incident?.scope.queueId === queueId
        ? Math.max(incident.currentFacts.agentDemandConversations, 20)
        : Math.max(
            Math.round(
              (predictive.summary.expectedContacts / Math.max(byQueue.size, 1)) * 0.2,
            ),
            10,
          );
    const requiredMemberCount = calculateRequiredAgents(expectedContacts);
    const currentMemberIds = queueMembers.map((member) => member.agent_id);
    const currentMemberCount = currentMemberIds.length;
    const allowedAddCount = Math.max(0, requiredMemberCount - currentMemberCount);
    const eligible = eligibleAgents
      .filter((agent) => !currentMemberIds.includes(agent.agent_id))
      .slice(0, 10)
      .map((agent) => ({
        agentId: agent.agent_id,
        displayName: agent.display_name,
        skills: Array.isArray(agent.skills) ? (agent.skills as string[]) : [],
        channels: Array.isArray(agent.channels) ? (agent.channels as string[]) : [channel],
        shiftAvailable: agent.presence_state !== "offline",
        availableCapacity: agent.presence_state === "ready" ? 2 : 1,
      }));

    requirements.push({
      queueId,
      queueName,
      channel,
      window: incident?.currentFacts.windowStart
        ? `${incident.currentFacts.windowStart}/${incident.currentFacts.windowEnd}`
        : `${startOfUtcDay(new Date()).toISOString()}/${new Date(Date.now() + 3 * 3_600_000).toISOString()}`,
      expectedContacts,
      currentMemberCount,
      requiredMemberCount,
      allowedAddCount,
      currentMemberIds,
      eligibleAgents: eligible,
    });
  }
  return requirements.sort((left, right) => right.allowedAddCount - left.allowedAddCount);
}

function buildOperationalRecommendations(
  incident: DiagnosticIncidentRecord | null,
  requirements: QueueRequirement[],
): PrescriptiveRecommendation[] {
  const recommendations: PrescriptiveRecommendation[] = [];
  if (incident) {
  const topDriver = incident.currentFacts.drivers[0];
    if (topDriver?.key === "no_agent_available" || topDriver?.key === "routing_exhausted") {
      recommendations.push({
        key: "increase_ready_coverage",
        priority: incident.severity === "high" || incident.severity === "critical" ? "high" : "medium",
        title: `Increase Ready coverage for ${incident.scope.queueName ?? incident.scope.channel}`,
        impact: "Impact not calibrated yet",
        rationale: incident.summary,
        action: "Review workforce schedule",
        impactStatus: "not_calibrated",
        destination: {
          type: "workforce_plan_review",
          queueId: incident.scope.queueId ?? undefined,
        },
      });
    }
    if (topDriver?.key === "offer_timeout" || topDriver?.key === "manual_reject") {
      recommendations.push({
        key: "review_offer_timeout",
        priority: "medium",
        title: "Review offer timeout settings",
        impact: "Impact not calibrated yet",
        rationale: "Offer timeouts contributed to the missed-contact spike.",
        action: "Update routing policy",
        impactStatus: "not_calibrated",
        destination: { type: "routing_policy_review" },
      });
    }
    recommendations.push({
      key: "assign_callbacks",
      priority: "medium",
      title: "Assign callbacks for unrecovered missed contacts",
      impact: "Impact not calibrated yet",
      rationale: "Recent missed contacts may still need proactive recovery.",
      action: "Open callback queue",
      impactStatus: "not_calibrated",
      destination: { type: "callback_queue" },
    });
  }

  for (const requirement of requirements.filter((row) => row.allowedAddCount > 0).slice(0, 2)) {
    const addAgents = requirement.eligibleAgents
      .slice(0, requirement.allowedAddCount)
      .map((agent) => ({ agentId: agent.agentId, displayName: agent.displayName }));
    recommendations.push({
      key: "daily_queue_assignment",
      priority: requirement.allowedAddCount >= 2 ? "high" : "medium",
      title: `Add ${requirement.allowedAddCount} Ready agent${requirement.allowedAddCount === 1 ? "" : "s"} to ${requirement.queueName}`,
      impact: "Impact not calibrated yet",
      rationale: `Forecast workload requires ${requirement.requiredMemberCount} agents while ${requirement.currentMemberCount} are assigned.`,
      action: "Review workforce plan",
      impactStatus: "not_calibrated",
      window: requirement.window,
      queue: {
        id: requirement.queueId,
        name: requirement.queueName,
        currentMemberCount: requirement.currentMemberCount,
        suggestedMemberCount: requirement.requiredMemberCount,
      },
      memberChanges: {
        add: addAgents,
        remove: [],
      },
      destination: {
        type: "workforce_plan_review",
        queueId: requirement.queueId,
      },
    });
  }

  return recommendations;
}

export async function buildPrescriptiveAnalytics(
  db: DbClient,
  organizationId: string,
  predictive: PredictiveAnalytics,
  incident: DiagnosticIncidentRecord | null,
  forecastRun: StoredForecastRun | null,
): Promise<PrescriptiveAnalytics> {
  const planDate = startOfUtcDay(new Date()).toISOString().slice(0, 10);
  const [members, eligibleAgents, previousPlan] = await Promise.all([
    loadQueueMembers(db, organizationId),
    loadEligibleAgents(db, organizationId),
    getLatestWorkforcePlan(db, organizationId, planDate),
  ]);

  if (members.length === 0 && !incident) {
    return emptyPrescriptive();
  }

  const requirements = buildQueueRequirements(members, eligibleAgents, predictive, incident);
  const inputSignature = hashInput({
    forecastVersion: predictive.forecastVersion,
    incidentId: incident?.id ?? null,
    requirements: requirements.map((row) => ({
      queueId: row.queueId,
      requiredMemberCount: row.requiredMemberCount,
      currentMemberCount: row.currentMemberCount,
      expectedContacts: row.expectedContacts,
    })),
  });

  if (previousPlan?.inputSignature === inputSignature && previousPlan.decision === "no_change") {
    return {
      decision: "no_change",
      planId: previousPlan.id,
      forecastVersion: predictive.forecastVersion,
      recommendations: [],
      source: previousPlan.source === "nlp" ? "nlp" : "rules",
    };
  }

  const deterministicRecommendations = buildOperationalRecommendations(incident, requirements);
  const planFingerprint = hashInput({
    recommendations: deterministicRecommendations.map((row) => ({
      key: row.key,
      queueId: row.queue?.id,
      add: row.memberChanges?.add.map((agent) => agent.agentId),
    })),
  });

  if (previousPlan?.planFingerprint === planFingerprint) {
    await saveWorkforcePlan(db, organizationId, {
      forecastRunId: forecastRun?.id ?? null,
      planDate,
      inputSignature,
      planFingerprint,
      decision: "no_change",
      status: "effective",
      previousPlanId: previousPlan.id,
      planJson: { recommendations: [] },
      source: "rules",
      schemaVersion: DASHBOARD_ANALYTICS_SCHEMA_VERSION,
    });
    return {
      decision: "no_change",
      planId: previousPlan.id,
      forecastVersion: predictive.forecastVersion,
      recommendations: [],
      source: "rules",
    };
  }

  const llmPlan = await fetchWorkforcePlan(organizationId, {
    forecastDate: planDate,
    forecastVersion: predictive.forecastVersion,
    inputSignature,
    previousPlan: previousPlan
      ? {
          planFingerprint: previousPlan.planFingerprint,
          forecastDate: previousPlan.planDate,
          queuePlans: [],
        }
      : null,
    diagnostic: incident
      ? {
          incidentId: incident.id,
          severity: incident.severity,
          queueId: incident.scope.queueId,
          queueName: incident.scope.queueName,
          topDriver: incident.currentFacts.topDriver,
          uniqueMissedConversations: incident.currentFacts.uniqueMissedConversations,
          missedContactRate: incident.currentFacts.missedContactRate,
          readyAgentsAverage: incident.currentFacts.readyAgentsAverage,
          baselineReadyAgents: incident.baselineFacts.readyAgentsAverage,
        }
      : null,
    predictive: {
      forecastWindow: requirements[0]?.window ?? null,
      expectedContacts: requirements[0]?.expectedContacts ?? 0,
      missedContactRisk: predictive.risks[0]?.tone === "high" ? "high" : "medium",
    },
    queueRequirements: requirements,
    allowedDecisions: ["update", "no_change"],
  });

  if (llmPlan?.decision === "no_change") {
    const saved = await saveWorkforcePlan(db, organizationId, {
      forecastRunId: forecastRun?.id ?? null,
      planDate,
      inputSignature,
      planFingerprint,
      decision: "no_change",
      status: "effective",
      previousPlanId: previousPlan?.id ?? null,
      planJson: { reason: llmPlan.reason ?? "No material change" },
      source: "nlp",
      schemaVersion: DASHBOARD_ANALYTICS_SCHEMA_VERSION,
      modelName: llmPlan.modelName ?? null,
    });
    return {
      decision: "no_change",
      planId: saved.id,
      forecastVersion: predictive.forecastVersion,
      recommendations: [],
      source: "nlp",
    };
  }

  let recommendations = deterministicRecommendations;
  if (llmPlan?.decision === "update" && llmPlan.queuePlans?.length) {
    recommendations = llmPlan.queuePlans.map((plan) => ({
      key: "daily_queue_assignment",
      priority: plan.priority,
      title: `Staff ${plan.queueName} with ${plan.suggestedMemberCount} agents`,
      impact: "Impact not calibrated yet",
      rationale: plan.rationale,
      action: "Review workforce plan",
      impactStatus: "not_calibrated" as const,
      window: plan.window,
      queue: {
        id: plan.queueId,
        name: plan.queueName,
        currentMemberCount: plan.currentMemberCount,
        suggestedMemberCount: plan.suggestedMemberCount,
      },
      memberChanges: {
        add: plan.addAgents.map((agent) => ({
          agentId: agent.agentId,
          displayName:
            requirements
              .find((row) => row.queueId === plan.queueId)
              ?.eligibleAgents.find((row) => row.agentId === agent.agentId)?.displayName ??
            `Agent ${agent.agentId}`,
        })),
        remove: plan.removeAgents.map((agent) => ({
          agentId: agent.agentId,
          displayName: `Agent ${agent.agentId}`,
        })),
      },
      destination: {
        type: "workforce_plan_review",
        queueId: plan.queueId,
      },
    }));
  }

  const saved = await saveWorkforcePlan(db, organizationId, {
    forecastRunId: forecastRun?.id ?? null,
    planDate,
    inputSignature,
    planFingerprint,
    decision: "update",
    status: "draft",
    previousPlanId: previousPlan?.id ?? null,
    planJson: { recommendations },
    source: llmPlan?.decision === "update" ? "nlp" : "rules",
    schemaVersion: DASHBOARD_ANALYTICS_SCHEMA_VERSION,
    modelName: llmPlan?.modelName ?? null,
  });

  return {
    decision: "update",
    planId: saved.id,
    forecastVersion: predictive.forecastVersion,
    recommendations,
    source: llmPlan?.decision === "update" ? "nlp" : "rules",
  };
}

export function serializeAgentId(agentId: string | null | undefined): string | null {
  return serializeEntityIdOptional(agentId);
}
