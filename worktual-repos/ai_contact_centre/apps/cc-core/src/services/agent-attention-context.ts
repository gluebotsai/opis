import { Prisma } from "@ai-contact-center/db-cc";
import type { DbClient } from "../lib/rls.js";
import { PRESENCE_STATE_SINCE_SQL } from "../lib/presence-state-since-sql.js";
import { serializeEntityId, serializeEntityIdOptional } from "../lib/id-schema.js";
import {
  getAgentAttendanceDay,
  todayYmd,
  type AgentAttendanceDay,
} from "./agent-attendance.js";
import {
  buildPerformanceKpis,
  loadAgentAggregate,
  loadOrgAggregate,
  resolvePerformanceWindow,
} from "./reporting.js";

export type AgentAttentionClassification =
  | "high_activity_not_ready"
  | "low_activity_pattern"
  | "repeat_escalation"
  | "queue_pressure"
  | "possible_stuck"
  | "isolated_incident";

export type AgentAttentionContextPacket = {
  agentId: string;
  agentName: string;
  teamName: string | null;
  queueNames: string[];
  presence: string;
  notReadyMinutes: number;
  activeConversations: number;
  reservedConversations: number;
  attendanceToday: "present" | "absent" | "unknown";
  todayKpis: {
    handled: number;
    teamAvgHandled: number | null;
    handledVsTeam: "above" | "below" | "near" | "unknown";
    resolutionRate: number | null;
    slaRate: number | null;
    avgHandleSeconds: number | null;
    transferred: number;
  };
  presenceTodaySeconds: Record<string, number>;
  escalationsLast7Days: number;
  queueWaitingTotal: number;
  offersRingingOrg: number | null;
  classification: AgentAttentionClassification;
  classificationReasons: string[];
  escalatedAt: string;
};

function minutesSince(iso: string | null | undefined, now = Date.now()): number {
  if (!iso) return 0;
  const ms = now - new Date(iso).getTime();
  return ms > 0 ? Math.floor(ms / 60_000) : 0;
}

function compareHandledToTeam(
  handled: number,
  teamAvg: number | null,
): AgentAttentionContextPacket["todayKpis"]["handledVsTeam"] {
  if (teamAvg == null || teamAvg <= 0) return "unknown";
  if (handled >= teamAvg * 1.2) return "above";
  if (handled <= teamAvg * 0.7) return "below";
  return "near";
}

export function classifyAgentAttention(input: {
  handled: number;
  teamAvgHandled: number | null;
  notReadyMinutes: number;
  escalationsLast7Days: number;
  activeConversations: number;
  queueWaitingTotal: number;
  presenceTodaySeconds: Record<string, number>;
  attendanceToday: "present" | "absent" | "unknown";
}): { classification: AgentAttentionClassification; reasons: string[] } {
  const reasons: string[] = [];
  const notReadySecondsToday = input.presenceTodaySeconds.not_ready ?? 0;
  const notReadyHoursToday = Math.round((notReadySecondsToday / 3600) * 10) / 10;

  if (input.escalationsLast7Days >= 3) {
    reasons.push(`${input.escalationsLast7Days} supervisor escalations in the last 7 days`);
    return { classification: "repeat_escalation", reasons };
  }

  if (input.queueWaitingTotal >= 3 && input.notReadyMinutes >= 10) {
    reasons.push(
      `${input.queueWaitingTotal} customers waiting while agent Not Ready ${input.notReadyMinutes} min`,
    );
    return { classification: "queue_pressure", reasons };
  }

  const handledVsTeam = compareHandledToTeam(input.handled, input.teamAvgHandled);
  if (handledVsTeam === "above" && input.notReadyMinutes >= 10) {
    reasons.push(
      `Handled ${input.handled} today${input.teamAvgHandled != null ? ` vs team avg ${Math.round(input.teamAvgHandled)}` : ""}`,
    );
    reasons.push(`Not Ready for ${input.notReadyMinutes} min with no active conversations`);
    return { classification: "high_activity_not_ready", reasons };
  }

  if (
    input.handled <= 2 &&
    input.notReadyMinutes >= 10 &&
    input.attendanceToday === "present"
  ) {
    reasons.push(`Only ${input.handled} handled today with ${input.notReadyMinutes} min Not Ready`);
    if (notReadyHoursToday >= 1) {
      reasons.push(`${notReadyHoursToday}h in Not Ready today already`);
    }
    return { classification: "possible_stuck", reasons };
  }

  if (handledVsTeam === "below" && input.notReadyMinutes >= 10) {
    reasons.push(`Below-team handled count (${input.handled} today)`);
    if (notReadyHoursToday >= 0.5) {
      reasons.push(`Not Ready ${notReadyHoursToday}h of login time today`);
    }
    return { classification: "low_activity_pattern", reasons };
  }

  reasons.push(`Not Ready ${input.notReadyMinutes} min; handled ${input.handled} today`);
  return { classification: "isolated_incident", reasons };
}

export async function buildAgentAttentionContext(
  db: DbClient,
  organizationId: string,
  agentId: string,
  options?: { escalatedAt?: string },
): Promise<AgentAttentionContextPacket | null> {
  const agentRows = await db.$queryRaw<
    Array<{
      id: string | bigint;
      display_name: string;
      setup_user_id: string | bigint | null;
      team_name: string | null;
      presence: string | null;
      presence_updated_at: Date | null;
    }>
  >`
    SELECT
      a.id,
      a.display_name,
      a.setup_user_id,
      t.name AS team_name,
      COALESCE(ap.presence_state, ap.status) AS presence,
      ${Prisma.raw(`${PRESENCE_STATE_SINCE_SQL} AS presence_updated_at`)}
    FROM ccass.agents a
    LEFT JOIN accounts.setup_users u ON u.id = a.setup_user_id
    LEFT JOIN accounts.setup_teams t ON t.id = u.team_id
    LEFT JOIN ccass.agent_presence ap
      ON ap.organization_id = a.organization_id
     AND ap.agent_id = a.id
    WHERE a.organization_id = ${organizationId}::bigint
      AND a.id = ${agentId}::bigint
    LIMIT 1
  `;
  const agent = agentRows[0];
  if (!agent) return null;

  const setupUserId = serializeEntityIdOptional(agent.setup_user_id);
  const todayWindow = resolvePerformanceWindow({ range: "today" });
  const todayYmdValue = todayYmd();

  let agentAgg = null;
  let orgAgg = null;
  if (setupUserId) {
    [agentAgg, orgAgg] = await Promise.all([
      loadAgentAggregate(db, organizationId, setupUserId, todayWindow.start, todayWindow.end),
      loadOrgAggregate(db, organizationId, todayWindow.start, todayWindow.end),
    ]);
  } else {
    orgAgg = await loadOrgAggregate(db, organizationId, todayWindow.start, todayWindow.end);
  }

  const agentKpis = agentAgg ? buildPerformanceKpis(agentAgg, agentAgg) : null;
  const orgKpis = buildPerformanceKpis(orgAgg, orgAgg);

  const loggedInRows = await db.$queryRaw<Array<{ count: bigint }>>`
    SELECT COUNT(DISTINCT ap.agent_id)::bigint AS count
    FROM ccass.agent_presence ap
    WHERE ap.organization_id = ${organizationId}::bigint
      AND lower(COALESCE(ap.presence_state, ap.status, 'offline')) IN (
        'ready', 'not_ready', 'break', 'busy', 'away', 'after_contact_work', 'available'
      )
  `;
  const loggedInAgents = Math.max(1, Number(loggedInRows[0]?.count ?? 1n));
  const teamAvgHandled =
    orgKpis.handled > 0 ? Math.round((orgKpis.handled / loggedInAgents) * 10) / 10 : null;

  const escalationRows = await db.$queryRaw<Array<{ count: bigint }>>`
    SELECT COUNT(*)::bigint AS count
    FROM ccass.agent_not_ready_escalations
    WHERE organization_id = ${organizationId}::bigint
      AND agent_id = ${agentId}::bigint
      AND escalated_at >= NOW() - INTERVAL '7 days'
  `;
  const escalationsLast7Days = Number(escalationRows[0]?.count ?? 0n);

  const capacityRows = await db.$queryRaw<
    Array<{ active_count: bigint; reserved_count: bigint }>
  >`
    SELECT
      COALESCE(SUM(ac.active_count), 0)::bigint AS active_count,
      COALESCE(SUM(ac.reserved_count), 0)::bigint AS reserved_count
    FROM ccass.agent_capacity ac
    WHERE ac.organization_id = ${organizationId}::bigint
      AND ac.agent_id = ${agentId}::bigint
  `;
  const activeConversations = Number(capacityRows[0]?.active_count ?? 0n);
  const reservedConversations = Number(capacityRows[0]?.reserved_count ?? 0n);

  const queueRows = await db.$queryRaw<Array<{ name: string }>>`
    SELECT DISTINCT q.name
    FROM ccass.queue_members qm
    JOIN ccass.queues q
      ON q.id = qm.queue_id
     AND q.organization_id = ${organizationId}::bigint
    WHERE qm.agent_id = ${agentId}::bigint
    ORDER BY q.name
    LIMIT 8
  `;
  const queueNames = queueRows.map((row) => row.name);

  let queueWaitingTotal = 0;
  if (queueNames.length > 0) {
    const waitingRows = await db.$queryRaw<Array<{ waiting: bigint }>>`
      SELECT COUNT(*)::bigint AS waiting
      FROM ccass.conversations c
      JOIN ccass.queues q ON q.id = c.queue_id
      WHERE c.organization_id = ${organizationId}::bigint
        AND c.status = 'queued'
        AND q.name = ANY(${queueNames}::text[])
    `;
    queueWaitingTotal = Number(waitingRows[0]?.waiting ?? 0n);
  }

  let attendanceDay: AgentAttendanceDay | null = null;
  try {
    const attendance = await getAgentAttendanceDay(
      db,
      organizationId,
      serializeEntityId(agent.id),
      todayYmdValue,
    );
    attendanceDay = attendance.day;
  } catch {
    attendanceDay = null;
  }

  const presence = (agent.presence ?? "not_ready").toLowerCase();
  const notReadyMinutes = minutesSince(agent.presence_updated_at?.toISOString());
  const handled = agentKpis?.handled ?? 0;
  const presenceTodaySeconds = attendanceDay?.durationsSeconds ?? {};
  const attendanceToday: AgentAttentionContextPacket["attendanceToday"] =
    attendanceDay && attendanceDay.hasHistory ? attendanceDay.attendance : "unknown";

  const { classification, reasons } = classifyAgentAttention({
    handled,
    teamAvgHandled: teamAvgHandled,
    notReadyMinutes,
    escalationsLast7Days,
    activeConversations,
    queueWaitingTotal,
    presenceTodaySeconds,
    attendanceToday,
  });

  return {
    agentId: serializeEntityId(agent.id),
    agentName: agent.display_name,
    teamName: agent.team_name,
    queueNames,
    presence,
    notReadyMinutes,
    activeConversations,
    reservedConversations,
    attendanceToday,
    todayKpis: {
      handled,
      teamAvgHandled,
      handledVsTeam: compareHandledToTeam(handled, teamAvgHandled),
      resolutionRate: agentKpis?.resolutionRate ?? null,
      slaRate: agentKpis?.slaRate ?? null,
      avgHandleSeconds: agentKpis?.avgHandleSeconds ?? null,
      transferred: agentKpis?.transferred ?? 0,
    },
    presenceTodaySeconds,
    escalationsLast7Days,
    queueWaitingTotal,
    offersRingingOrg: null,
    classification,
    classificationReasons: reasons,
    escalatedAt: options?.escalatedAt ?? new Date().toISOString(),
  };
}
