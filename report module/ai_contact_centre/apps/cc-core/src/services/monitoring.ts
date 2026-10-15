import type { DbClient } from "../lib/rls.js";
import { Prisma, type PrismaClient } from "@ai-contact-center/db-cc";

import { isEntityId, serializeEntityId } from "../lib/id-schema.js";
import { formatPersonDisplayName } from "../lib/person-display-name.js";
import { revokeAuthSessionsForEmail } from "./auth-sessions.js";
import { resolveAgentPresenceState, setAgentPresenceByAgentId } from "./presence.js";
import { isLoggedInPresenceState } from "./presence-cache.js";
import { listRecentNotReadyEscalations } from "./agent-not-ready-escalations.js";
import {
  dedupeProactiveAttemptsForSupervisorAlerts,
  listUnacknowledgedProactiveAttempts,
} from "./proactive-callback-attempts.js";
import { buildMissedContactOpenCallbackExistsSql } from "./callback-task-dedupe.js";
import { listPresence } from "./workforce.js";
import { loadPresentAgentIdsToday } from "./agent-attendance.js";
import { normalizeMissedContactReason } from "./agent-missed-contacts.js";
import { listVeryNegativeSentimentAlerts } from "./monitoring-sentiment-alerts.js";
import {
  listContactCenterAdminUserIds,
  unassignOpenAdminCallbacks,
} from "./callback-assignee.js";

export type MonitoringSnapshot = {
  generatedAt: string;
  summary: {
    waiting: number;
    active: number;
    botActive: number;
    readyAgents: number;
    loggedInAgents: number;
    slaAtRisk: number;
    slaBreached: number;
    offersRinging: number;
  };
  queues: Array<{
    id: string;
    name: string;
    waiting: number;
    active: number;
    botActive: number;
    oldestWaitSeconds: number | null;
    readyAgents: number;
  }>;
  agents: Array<{
    id: string;
    agentId: string;
    name: string;
    email: string;
    workEmail: string | null;
    employeeId: string | null;
    firstName: string | null;
    lastName: string | null;
    teamName: string | null;
    skills: string[];
    shiftTypes: string[];
    primaryLanguage: string | null;
    secondaryLanguage: string | null;
    location: string | null;
    accountStatus: string | null;
    agentStatus: string;
    presenceUpdatedAt: string | null;
    presence: string;
    /** True when presence is a logged-in state. Offline/inactive are logged out. */
    loggedIn: boolean;
    /** Logged in at any point today (org local day), even if currently offline. */
    attendanceToday: "present" | "absent";
    /** False for admin users. Callbacks can only be assigned to agents. */
    canReceiveCallback: boolean;
    queueNames: string[];
    capacity: Array<{
      channel: string;
      active: number;
      reserved: number;
      max: number;
    }>;
    previousConversations: Array<{
      id: string;
      channel: string;
      customerName: string;
      subject: string | null;
      queueName: string | null;
      endedAt: string;
    }>;
  }>;
  conversations: Array<{
    id: string;
    channel: string;
    status: string;
    subject: string | null;
    visitorId: string | null;
    contactId: string | null;
    customerName: string;
    queueId: string | null;
    queueName: string | null;
    assignedAgentId: string | null;
    assignedAgentName: string | null;
    waitSeconds: number | null;
    activeSeconds: number | null;
    createdAt: string;
    priority: number;
    slaStatus: "ok" | "warning" | "breached" | null;
  }>;
  waiting: Array<{
    id: string;
    conversationId: string;
    contactId: string | null;
    customerName: string;
    channel: string;
    queueId: string | null;
    queueName: string | null;
    waitingSeconds: number;
    position: number;
    priority: number;
    slaStatus: "ok" | "warning" | "breached" | null;
  }>;
  missed: Array<{
    id: string;
    conversationId: string | null;
    contactId: string | null;
    customerName: string;
    channel: string;
    queueId: string | null;
    queueName: string | null;
    occurredAt: string;
    waitSeconds: number | null;
    reason: "offer_timeout" | "no_agent_available";
    priority: "low" | "normal" | "high" | "critical";
    callbackAssigned: boolean;
    callbackAssignedAgentName: string | null;
    callbackTaskId: string | null;
    callbackStatus: "open" | "completed" | null;
    callbackAssignmentSource: "admin" | "coworker" | null;
    connectedAfterMiss: boolean;
    connectedAt: string | null;
    connectedAgentName: string | null;
  }>;
  callbacks: Array<{
    id: string;
    taskId: string;
    conversationId: string | null;
    contactId: string | null;
    customerName: string;
    channel: string;
    title: string;
    assignedAgentName: string;
    assignedBy: string | null;
    assignmentSource: "admin" | "coworker" | null;
    createdAt: string;
    status: "open" | "completed" | "dismissed";
    completedAt: string | null;
    priority: "low" | "normal" | "high" | "critical";
  }>;
  alerts: Array<
    | {
        id: string;
        type: "sla_warning" | "sla_breached" | "offer_expiring" | "long_wait";
        severity: "warning" | "critical";
        title: string;
        detail: string;
        conversationId?: string;
        queueId?: string;
      }
    | {
        id: string;
        type: "agent_not_ready_extended";
        severity: "warning";
        title: string;
        detail: string;
        agentId: string;
        createdAt: string;
      }
    | {
        id: string;
        type: "agent_not_ready_escalated";
        severity: "critical";
        title: string;
        detail: string;
        agentId: string;
        escalationId: string;
        createdAt: string;
        insight?: {
          summary: string;
          suggestion: string;
          classification: string;
          classificationLabel?: string;
        };
      }
    | {
        id: string;
        type: "coworker_callback_assigned";
        severity: "info";
        title: string;
        detail: string;
        attemptId: string;
        taskId: string;
        contactId?: string;
        queueId?: string;
        channel?: string;
        missedContactId?: string;
        createdAt: string;
      }
    | {
        id: string;
        type: "sentiment_very_negative";
        severity: "critical";
        title: string;
        detail: string;
        conversationId: string;
        channel: string;
        customerName: string;
        agentName: string;
        queueName: string | null;
        subject: string | null;
        side: "customer" | "agent";
        createdAt: string;
      }
  >;
};

type QueueStatsRow = {
  id: string | bigint;
  name: string;
  waiting: bigint;
  active: bigint;
  bot_active: bigint;
  oldest_wait_seconds: number | null;
  close_time: string | null;
};

type ConversationRow = {
  id: string | bigint;
  channel: string;
  status: string;
  subject: string | null;
  visitor_id: string | null;
  contact_id: string | bigint | null;
  customer_name: string | null;
  queue_id: string | bigint | null;
  queue_name: string | null;
  assigned_agent_id: string | bigint | null;
  assigned_agent_name: string | null;
  wait_seconds: number | null;
  active_seconds: number | null;
  created_at: Date;
  priority: number | null;
  queue_position: number | null;
  sla_status: string | null;
};

type MissedContactRow = {
  id: string | bigint;
  conversation_id: string | bigint;
  contact_id: string | bigint | null;
  queue_id: string | bigint | null;
  queue_name: string | null;
  channel: string;
  reason: string;
  customer_name: string;
  offered_at: Date | null;
  missed_at: Date;
  callback_task_id: string | bigint | null;
  callback_assigned_agent_name: string | null;
  callback_status: string | null;
  callback_assignment_source: string | null;
  connected_at: Date | null;
  connected_agent_name: string | null;
};

type AgentHistoryRow = {
  id: string | bigint;
  assigned_agent_id: string | bigint;
  channel: string;
  subject: string | null;
  customer_name: string | null;
  queue_name: string | null;
  ended_at: Date;
};

export type AgentPreviousConversation =
  MonitoringSnapshot["agents"][number]["previousConversations"][number];

function toPreviousConversation(row: AgentHistoryRow): AgentPreviousConversation {
  return {
    id: serializeEntityId(row.id),
    channel: row.channel,
    customerName: formatPersonDisplayName({ fullName: row.customer_name }),
    subject: row.subject,
    queueName: row.queue_name,
    endedAt: row.ended_at.toISOString(),
  };
}

export async function listAgentPreviousConversations(
  db: DbClient,
  organizationId: string,
  agentId: string,
): Promise<AgentPreviousConversation[]> {
  const rows = await db.$queryRaw<AgentHistoryRow[]>`
    SELECT
      c.id,
      c.assigned_agent_id,
      c.channel,
      c.subject,
      COALESCE(
        NULLIF(TRIM(CONCAT(NULLIF(TRIM(cp.first_name), ''), ' ', NULLIF(TRIM(cp.last_name), ''))), ''),
        NULLIF(TRIM(cp.first_name), ''),
        NULLIF(TRIM(cp.last_name), ''),
        NULLIF(c.subject, ''),
        'Customer'
      ) AS customer_name,
      q.name AS queue_name,
      COALESCE(c.ended_at, c.updated_at) AS ended_at
    FROM ccass.conversations c
    LEFT JOIN ccass.queues q ON q.id = c.queue_id
    LEFT JOIN cdp.customer_profile cp
      ON cp.cdp_id = c.contact_id
     AND cp.organization_id = c.organization_id
    WHERE c.organization_id = ${organizationId}::bigint
      AND c.assigned_agent_id = ${agentId}::bigint
      AND c.status IN ('resolved', 'closed')
    ORDER BY COALESCE(c.ended_at, c.updated_at) DESC
    LIMIT 1000
  `;
  return rows.map(toPreviousConversation);
}

type CallbackTaskRow = {
  id: string | bigint;
  conversation_id: string | bigint | null;
  contact_id: string | bigint | null;
  channel: string | null;
  priority: string;
  title: string;
  assigned_by_label: string | null;
  task_source: string | null;
  assigned_agent_name: string | null;
  created_at: Date;
  first_name: string | null;
  last_name: string | null;
  customer_name: string | null;
  status: string;
  completed_at: Date | null;
};

type SlaSummaryRow = {
  at_risk: bigint;
  breached: bigint;
};

type CapacityRow = {
  agent_id: string | bigint;
  channel: string;
  active_count: bigint;
  reserved_count: bigint;
  max_concurrency: bigint;
};

const LOGGED_IN_PRESENCE = new Set([
  "ready",
  "not_ready",
  "break",
  "busy",
  "away",
  "after_contact_work",
  "available",
]);

function mapSlaStatus(value: string | null): MonitoringSnapshot["conversations"][number]["slaStatus"] {
  if (value === "warning" || value === "breached" || value === "ok") return value;
  return null;
}

function mapAssignmentSource(value: string | null): "admin" | "coworker" | null {
  if (value === "coworker") return "coworker";
  if (value === "admin") return "admin";
  return null;
}

function mapTaskPriority(value: string): MonitoringSnapshot["missed"][number]["priority"] {
  if (value === "low" || value === "normal" || value === "high" || value === "critical") {
    return value;
  }
  return "normal";
}

function mapCallbackStatus(
  value: string,
): MonitoringSnapshot["callbacks"][number]["status"] {
  if (value === "completed" || value === "dismissed") return value;
  return "open";
}

function formatCustomerName(row: Pick<ConversationRow, "customer_name" | "visitor_id">): string {
  return formatPersonDisplayName({
    fullName: row.customer_name,
    visitorId: row.visitor_id,
  });
}

function formatWait(seconds: number | null): string {
  if (seconds == null || seconds < 0) return "—";
  if (seconds < 60) return `${Math.round(seconds)}s`;
  const minutes = Math.floor(seconds / 60);
  const remainder = Math.round(seconds % 60);
  return remainder ? `${minutes}m ${remainder}s` : `${minutes}m`;
}

export async function loadMonitoringSnapshot(
  db: DbClient,
  organizationId: string,
  rootPrisma?: PrismaClient,
): Promise<MonitoringSnapshot> {
  await unassignOpenAdminCallbacks(db, organizationId);
  const adminUserIds = await listContactCenterAdminUserIds(db, organizationId);
  const [presence, queueRows, slaSummary, offersRinging, conversationRows, capacityRows, missedRows, callbackRows, agentHistoryRows] =
    await Promise.all([
      listPresence(db, organizationId, rootPrisma),
      db.$queryRaw<QueueStatsRow[]>`
        SELECT
          q.id,
          q.name,
          COUNT(*) FILTER (WHERE c.status = 'queued')::bigint AS waiting,
          COUNT(*) FILTER (WHERE c.status IN ('assigned', 'active'))::bigint AS active,
          COUNT(*) FILTER (WHERE c.status = 'bot_active')::bigint AS bot_active,
          MAX(
            EXTRACT(EPOCH FROM (NOW() - c.queued_at))
          ) FILTER (WHERE c.status = 'queued' AND c.queued_at IS NOT NULL)::float8 AS oldest_wait_seconds,
          to_char(bh.close_time, 'HH24:MI') AS close_time
        FROM ccass.queues q
        LEFT JOIN accounts.setup_business_hours bh ON bh.id = q.business_hours_id
        LEFT JOIN ccass.conversations c
          ON c.queue_id = q.id
         AND c.organization_id = q.organization_id
         AND c.status NOT IN ('resolved', 'closed')
        WHERE q.organization_id = ${organizationId}::bigint
          AND q.status = 'active'
        GROUP BY q.id, q.name, bh.close_time
        ORDER BY q.name ASC
      `,
      db.$queryRaw<SlaSummaryRow[]>`
        SELECT
          COUNT(*) FILTER (
            WHERE css.breached_at IS NULL
              AND (
                (css.first_response_warning_at IS NOT NULL AND css.first_response_warning_at <= NOW())
                OR (css.resolution_warning_at IS NOT NULL AND css.resolution_warning_at <= NOW())
              )
          )::bigint AS at_risk,
          COUNT(*) FILTER (WHERE css.breached_at IS NOT NULL)::bigint AS breached
        FROM ccass.conversation_sla_state css
        INNER JOIN ccass.conversations c ON c.id = css.conversation_id
        WHERE css.organization_id = ${organizationId}::bigint
          AND c.status NOT IN ('resolved', 'closed')
      `,
      db.$queryRaw<{ count: bigint }[]>`
        SELECT COUNT(*)::bigint AS count
        FROM ccass.conversation_assignments ca
        WHERE ca.organization_id = ${organizationId}::bigint
          AND ca.state = 'offered'
          AND (ca.expires_at IS NULL OR ca.expires_at > NOW())
      `,
      db.$queryRaw<ConversationRow[]>`
        SELECT
          c.id,
          c.channel,
          c.status,
          c.subject,
          c.visitor_id,
          c.contact_id,
          COALESCE(
            NULLIF(TRIM(CONCAT(NULLIF(TRIM(cp.first_name), ''), ' ', NULLIF(TRIM(cp.last_name), ''))), ''),
            NULLIF(TRIM(cp.first_name), ''),
            NULLIF(TRIM(cp.last_name), ''),
            NULLIF(c.subject, '')
          ) AS customer_name,
          c.queue_id,
          q.name AS queue_name,
          c.assigned_agent_id,
          a.display_name AS assigned_agent_name,
          c.priority,
          CASE
            WHEN c.status = 'queued' AND c.queued_at IS NOT NULL
              THEN EXTRACT(EPOCH FROM (NOW() - c.queued_at))::float8
            ELSE NULL
          END AS wait_seconds,
          CASE
            WHEN c.status IN ('assigned', 'active') AND c.assigned_at IS NOT NULL
              THEN EXTRACT(EPOCH FROM (NOW() - c.assigned_at))::float8
            WHEN c.status IN ('assigned', 'active')
              THEN EXTRACT(EPOCH FROM (NOW() - c.updated_at))::float8
            ELSE EXTRACT(EPOCH FROM (NOW() - c.created_at))::float8
          END AS active_seconds,
          c.created_at,
          ROW_NUMBER() OVER (
            PARTITION BY c.queue_id
            ORDER BY c.priority DESC, c.queued_at ASC NULLS LAST, c.updated_at ASC
          )::int AS queue_position,
          CASE
            WHEN css.breached_at IS NOT NULL THEN 'breached'
            WHEN css.first_response_warning_at IS NOT NULL AND css.first_response_warning_at <= NOW()
              THEN 'warning'
            WHEN css.resolution_warning_at IS NOT NULL AND css.resolution_warning_at <= NOW()
              THEN 'warning'
            ELSE 'ok'
          END AS sla_status
        FROM ccass.conversations c
        LEFT JOIN ccass.queues q ON q.id = c.queue_id
        LEFT JOIN ccass.agents a ON a.id = c.assigned_agent_id
        LEFT JOIN cdp.customer_profile cp
          ON cp.cdp_id = c.contact_id
         AND cp.organization_id = c.organization_id
        LEFT JOIN ccass.conversation_sla_state css
          ON css.conversation_id = c.id
         AND css.organization_id = c.organization_id
        WHERE c.organization_id = ${organizationId}::bigint
          AND c.status IN ('queued', 'assigned', 'active', 'bot_active')
        ORDER BY
          CASE c.status
            WHEN 'queued' THEN 0
            WHEN 'assigned' THEN 1
            WHEN 'active' THEN 2
            ELSE 3
          END,
          c.queued_at ASC NULLS LAST,
          c.updated_at DESC
        LIMIT 50
      `,
      db.$queryRaw<CapacityRow[]>`
        SELECT agent_id, channel, active_count, reserved_count, max_concurrency
        FROM ccass.agent_capacity
        WHERE organization_id = ${organizationId}::bigint
      `,
      db.$queryRaw<MissedContactRow[]>`
        SELECT
          mc.id,
          mc.conversation_id,
          mc.contact_id,
          mc.queue_id,
          q.name AS queue_name,
          mc.channel,
          mc.reason,
          COALESCE(
            NULLIF(
              TRIM(
                CONCAT(
                  NULLIF(TRIM(cp_missed.first_name), ''),
                  ' ',
                  CASE
                    WHEN LOWER(NULLIF(TRIM(cp_missed.last_name), '')) =
                         LOWER(NULLIF(TRIM(cp_missed.first_name), ''))
                    THEN NULL
                    ELSE NULLIF(TRIM(cp_missed.last_name), '')
                  END
                )
              ),
              ''
            ),
            NULLIF(TRIM(cp_missed.first_name), ''),
            NULLIF(TRIM(cp_missed.last_name), ''),
            mc.customer_name
          ) AS customer_name,
          mc.offered_at,
          mc.missed_at,
          cb.task_id AS callback_task_id,
          cb.assigned_agent_name AS callback_assigned_agent_name,
          cb.callback_status,
          cb.task_source AS callback_assignment_source,
          follow_up.connected_at,
          follow_up.connected_agent_name
        FROM ccass.agent_missed_contacts mc
        LEFT JOIN ccass.queues q ON q.id = mc.queue_id
        LEFT JOIN cdp.customer_profile cp_missed
          ON cp_missed.organization_id = mc.organization_id
         AND cp_missed.cdp_id = mc.contact_id
        LEFT JOIN LATERAL (
          SELECT
            c.ended_at AS connected_at,
            COALESCE(
              a.display_name,
              NULLIF(TRIM(CONCAT(u.first_name, ' ', u.last_name)), '')
            ) AS connected_agent_name
          FROM ccass.conversations c
          LEFT JOIN ccass.agents a
            ON a.id = c.assigned_agent_id
           AND a.organization_id = c.organization_id
          LEFT JOIN accounts.setup_users u
            ON u.id = c.assigned_user_id
           AND u.organization_id = c.organization_id
          WHERE c.organization_id = mc.organization_id
            AND c.status IN ('resolved', 'closed')
            AND c.assigned_agent_id IS NOT NULL
            AND c.ended_at IS NOT NULL
            AND c.ended_at >= mc.missed_at
            AND COALESCE(c.direction, 'inbound') = 'inbound'
            AND NOT EXISTS (
              SELECT 1
              FROM ccass.agent_tasks t
              WHERE t.organization_id = c.organization_id
                AND t.conversation_id = c.id
                AND t.task_type = 'callback'
            )
            AND (
              c.id = mc.conversation_id
              OR (
                mc.contact_id IS NOT NULL
                AND c.contact_id = mc.contact_id
                AND c.channel = mc.channel
              )
            )
          ORDER BY c.ended_at ASC
          LIMIT 1
        ) follow_up ON TRUE
        LEFT JOIN LATERAL (
          SELECT
            t.id AS task_id,
            t.status AS callback_status,
            t.source AS task_source,
            COALESCE(
              a.display_name,
              NULLIF(TRIM(CONCAT(u.first_name, ' ', u.last_name)), '')
            ) AS assigned_agent_name
          FROM ccass.agent_tasks t
          LEFT JOIN accounts.setup_users u
            ON u.id = t.assigned_user_id
           AND u.organization_id = t.organization_id
          LEFT JOIN ccass.agents a
            ON a.setup_user_id = t.assigned_user_id
           AND a.organization_id = t.organization_id
          WHERE t.organization_id = mc.organization_id
            AND t.task_type = 'callback'
            AND (
              t.status = 'open'
              OR (
                t.status = 'completed'
                AND t.completed_at IS NOT NULL
                AND t.completed_at >= mc.missed_at
              )
            )
            AND (
              ${Prisma.raw(buildMissedContactOpenCallbackExistsSql("mc", "t"))}
            )
          ORDER BY
            -- Prefer the callback for this exact conversation, then supervisor
            -- over coworker, so an open coworker task on the same person cannot
            -- hide a manual supervisor assignment for this miss.
            CASE
              WHEN t.conversation_id IS NOT NULL
               AND t.conversation_id = mc.conversation_id THEN 0
              ELSE 1
            END ASC,
            CASE
              WHEN t.source = 'admin' THEN 0
              WHEN t.source = 'coworker' THEN 1
              ELSE 2
            END ASC,
            CASE WHEN t.status = 'open' THEN 0 ELSE 1 END ASC,
            COALESCE(t.completed_at, t.updated_at, t.created_at) DESC
          LIMIT 1
        ) cb ON TRUE
        WHERE mc.organization_id = ${organizationId}::bigint
          AND mc.missed_at >= NOW() - INTERVAL '7 days'
        ORDER BY mc.missed_at DESC
        LIMIT 40
      `,
      db.$queryRaw<CallbackTaskRow[]>`
        SELECT
          t.id,
          t.conversation_id,
          t.contact_id,
          t.channel,
          t.priority,
          t.title,
          t.assigned_by_label,
          t.source AS task_source,
          COALESCE(
            a.display_name,
            NULLIF(TRIM(CONCAT(u.first_name, ' ', u.last_name)), '')
          ) AS assigned_agent_name,
          t.created_at,
          t.status,
          t.completed_at,
          cp.first_name,
          cp.last_name,
          COALESCE(
            NULLIF(TRIM(CONCAT(NULLIF(TRIM(cp.first_name), ''), ' ', NULLIF(TRIM(cp.last_name), ''))), ''),
            NULLIF(TRIM(cp.first_name), ''),
            NULLIF(TRIM(cp.last_name), ''),
            NULLIF(TRIM(t.metadata->>'customerName'), ''),
            NULLIF(TRIM(mc_snap.customer_name), '')
          ) AS customer_name
        FROM ccass.agent_tasks t
        LEFT JOIN cdp.customer_profile cp
          ON cp.cdp_id = t.contact_id
         AND cp.organization_id = t.organization_id
        LEFT JOIN LATERAL (
          SELECT mc.customer_name
          FROM ccass.agent_missed_contacts mc
          WHERE mc.organization_id = t.organization_id
            AND mc.conversation_id = t.conversation_id
          ORDER BY mc.missed_at DESC
          LIMIT 1
        ) mc_snap ON TRUE
        LEFT JOIN accounts.setup_users u
          ON u.id = t.assigned_user_id
         AND u.organization_id = t.organization_id
        LEFT JOIN ccass.agents a
          ON a.setup_user_id = t.assigned_user_id
         AND a.organization_id = t.organization_id
        WHERE t.organization_id = ${organizationId}::bigint
          AND t.task_type = 'callback'
          AND (
            t.status = 'open'
            OR (
              t.status = 'completed'
              AND t.completed_at >= NOW() - INTERVAL '7 days'
            )
          )
        ORDER BY
          CASE t.status WHEN 'open' THEN 0 ELSE 1 END,
          t.created_at DESC
        LIMIT 40
      `,
      db.$queryRaw<AgentHistoryRow[]>`
        SELECT
          c.id,
          c.assigned_agent_id,
          c.channel,
          c.subject,
          COALESCE(
            NULLIF(TRIM(CONCAT(NULLIF(TRIM(cp.first_name), ''), ' ', NULLIF(TRIM(cp.last_name), ''))), ''),
            NULLIF(TRIM(cp.first_name), ''),
            NULLIF(TRIM(cp.last_name), ''),
            NULLIF(c.subject, ''),
            'Customer'
          ) AS customer_name,
          q.name AS queue_name,
          COALESCE(c.ended_at, c.updated_at) AS ended_at
        FROM ccass.conversations c
        LEFT JOIN ccass.queues q ON q.id = c.queue_id
        LEFT JOIN cdp.customer_profile cp
          ON cp.cdp_id = c.contact_id
         AND cp.organization_id = c.organization_id
        WHERE c.organization_id = ${organizationId}::bigint
          AND c.status IN ('resolved', 'closed')
          AND c.assigned_agent_id IS NOT NULL
          AND COALESCE(c.ended_at, c.updated_at) >= NOW() - INTERVAL '7 days'
        ORDER BY COALESCE(c.ended_at, c.updated_at) DESC
        LIMIT 200
      `,
    ]);

  const capacityByAgent = new Map<string, CapacityRow[]>();
  for (const row of capacityRows) {
    const agentId = serializeEntityId(row.agent_id);
    const bucket = capacityByAgent.get(agentId) ?? [];
    bucket.push(row);
    capacityByAgent.set(agentId, bucket);
  }

  const previousByAgent = new Map<
    string,
    MonitoringSnapshot["agents"][number]["previousConversations"]
  >();
  for (const row of agentHistoryRows) {
    const agentId = serializeEntityId(row.assigned_agent_id);
    const bucket = previousByAgent.get(agentId) ?? [];
    if (bucket.length >= 20) continue;
    bucket.push(toPreviousConversation(row));
    previousByAgent.set(agentId, bucket);
  }

  const monitoringAgents = presence.agents;

  const readyAgents = monitoringAgents.filter((agent) => agent.presence === "ready").length;
  const loggedInAgents = monitoringAgents.filter((agent) =>
    LOGGED_IN_PRESENCE.has(agent.presence),
  ).length;

  const readyByQueue = new Map<string, number>();
  for (const agent of monitoringAgents) {
    if (agent.presence !== "ready") continue;
    for (const queueId of agent.queueIds ?? []) {
      readyByQueue.set(queueId, (readyByQueue.get(queueId) ?? 0) + 1);
    }
  }

  const queues = queueRows.map((row) => ({
    id: serializeEntityId(row.id),
    name: row.name,
    waiting: Number(row.waiting),
    active: Number(row.active),
    botActive: Number(row.bot_active),
    oldestWaitSeconds:
      row.oldest_wait_seconds == null ? null : Math.max(0, Math.round(row.oldest_wait_seconds)),
    readyAgents: readyByQueue.get(serializeEntityId(row.id)) ?? 0,
    closeTime: row.close_time?.trim() || null,
  }));

  const waitingCount = queues.reduce((sum, queue) => sum + queue.waiting, 0);
  const active = queues.reduce((sum, queue) => sum + queue.active, 0);
  const botActive = queues.reduce((sum, queue) => sum + queue.botActive, 0);

  const conversations = conversationRows.map((row) => ({
    id: serializeEntityId(row.id),
    channel: row.channel,
    status: row.status,
    subject: row.subject,
    visitorId: row.visitor_id,
    contactId: row.contact_id == null ? null : serializeEntityId(row.contact_id),
    customerName: formatCustomerName(row),
    queueId: row.queue_id == null ? null : serializeEntityId(row.queue_id),
    queueName: row.queue_name,
    assignedAgentId:
      row.assigned_agent_id == null ? null : serializeEntityId(row.assigned_agent_id),
    assignedAgentName: row.assigned_agent_name,
    waitSeconds: row.wait_seconds == null ? null : Math.max(0, Math.round(row.wait_seconds)),
    activeSeconds:
      row.active_seconds == null ? null : Math.max(0, Math.round(row.active_seconds)),
    createdAt: row.created_at.toISOString(),
    priority: Number(row.priority ?? 0),
    slaStatus: mapSlaStatus(row.sla_status),
  }));

  const waitingInteractions = conversationRows
    .filter((row) => row.status === "queued")
    .map((row) => ({
      id: serializeEntityId(row.id),
      conversationId: serializeEntityId(row.id),
      contactId: row.contact_id == null ? null : serializeEntityId(row.contact_id),
      customerName: formatCustomerName(row),
      channel: row.channel,
      queueId: row.queue_id == null ? null : serializeEntityId(row.queue_id),
      queueName: row.queue_name,
      waitingSeconds: row.wait_seconds == null ? 0 : Math.max(0, Math.round(row.wait_seconds)),
      position: Number(row.queue_position ?? 1),
      priority: Number(row.priority ?? 0),
      slaStatus: mapSlaStatus(row.sla_status),
    }));

  const missedFromContacts = missedRows.map((row) => ({
    id: `missed-${serializeEntityId(row.id)}`,
    conversationId:
      row.conversation_id == null ? null : serializeEntityId(row.conversation_id),
    contactId: row.contact_id == null ? null : serializeEntityId(row.contact_id),
    customerName: formatPersonDisplayName({ fullName: row.customer_name }),
    channel: row.channel,
    queueId: row.queue_id == null ? null : serializeEntityId(row.queue_id),
    queueName: row.queue_name,
    occurredAt: row.missed_at.toISOString(),
    waitSeconds:
      row.offered_at == null
        ? null
        : Math.max(0, Math.round((row.missed_at.getTime() - row.offered_at.getTime()) / 1000)),
    reason: normalizeMissedContactReason(row.reason),
    priority: "normal" as const,
    callbackAssigned: row.callback_task_id != null,
    callbackAssignedAgentName: row.callback_assigned_agent_name?.trim() || null,
    callbackTaskId:
      row.callback_task_id == null ? null : serializeEntityId(row.callback_task_id),
    callbackStatus: ((): "open" | "completed" | null => {
      if (row.callback_status === "open" || row.callback_status === "completed") {
        return row.callback_status;
      }
      return null;
    })(),
    callbackAssignmentSource: mapAssignmentSource(row.callback_assignment_source),
    connectedAfterMiss: row.connected_at != null,
    connectedAt: row.connected_at?.toISOString() ?? null,
    connectedAgentName: row.connected_agent_name?.trim() || null,
  }));

  const missed = missedFromContacts.slice(0, 40);

  const callbacks = callbackRows
    .filter((row) => row.channel)
    .map((row) => ({
      id: `callback-${serializeEntityId(row.id)}`,
      taskId: serializeEntityId(row.id),
      conversationId:
        row.conversation_id == null ? null : serializeEntityId(row.conversation_id),
      contactId: row.contact_id == null ? null : serializeEntityId(row.contact_id),
      customerName: formatPersonDisplayName({
        firstName: row.first_name,
        lastName: row.last_name,
        fullName: row.customer_name,
      }),
      channel: row.channel!,
      title: row.title,
      assignedAgentName: row.assigned_agent_name?.trim() || "Unassigned",
      assignedBy: row.assigned_by_label,
      assignmentSource: mapAssignmentSource(row.task_source),
      createdAt: row.created_at.toISOString(),
      status: mapCallbackStatus(row.status),
      completedAt: row.completed_at?.toISOString() ?? null,
      priority: mapTaskPriority(row.priority),
    }));

  const alerts: MonitoringSnapshot["alerts"] = [];

  for (const conversation of conversations) {
    if (conversation.slaStatus === "breached") {
      alerts.push({
        id: `sla-breached-${conversation.id}`,
        type: "sla_breached",
        severity: "critical",
        title: "SLA breached",
        detail: `${conversation.channel} · ${conversation.subject ?? conversation.visitorId ?? conversation.id}`,
        conversationId: conversation.id,
        queueId: conversation.queueId ?? undefined,
      });
    } else if (conversation.slaStatus === "warning") {
      alerts.push({
        id: `sla-warning-${conversation.id}`,
        type: "sla_warning",
        severity: "warning",
        title: "SLA at risk",
        detail: `${conversation.channel} · ${conversation.subject ?? conversation.visitorId ?? conversation.id}`,
        conversationId: conversation.id,
        queueId: conversation.queueId ?? undefined,
      });
    }

    if (
      conversation.status === "queued" &&
      conversation.waitSeconds != null &&
      conversation.waitSeconds >= 120
    ) {
      alerts.push({
        id: `long-wait-${conversation.id}`,
        type: "long_wait",
        severity: conversation.waitSeconds >= 300 ? "critical" : "warning",
        title: "Long wait",
        detail: `${formatWait(conversation.waitSeconds)} in ${conversation.queueName ?? "queue"}`,
        conversationId: conversation.id,
        queueId: conversation.queueId ?? undefined,
      });
    }
  }

  const offersCount = Number(offersRinging[0]?.count ?? 0n);
  if (offersCount > 0) {
    alerts.push({
      id: "offers-ringing",
      type: "offer_expiring",
      severity: "warning",
      title: "Offers ringing",
      detail: `${offersCount} assignment offer${offersCount === 1 ? "" : "s"} awaiting agent response`,
    });
  }

  // TODO(testing): restore to 10 * 60_000 before production.
  const supervisorNotReadyMs = 3 * 60_000;
  const nowMs = Date.now();
  const escalatedAgentIds = new Set<string>();

  const notReadyEscalations = await listRecentNotReadyEscalations(db, organizationId, 20);
  for (const escalation of notReadyEscalations) {
    escalatedAgentIds.add(escalation.agentId);
    const insightSummary = escalation.insightSummary?.trim();
    const insightSuggestion = escalation.insightSuggestion?.trim();
    alerts.push({
      id: `not-ready-escalated-${escalation.id}`,
      type: "agent_not_ready_escalated",
      severity: "critical",
      title: `${escalation.agentName} needs attention`,
      detail:
        insightSummary ??
        "Agent stayed Not Ready. Supervisor follow-up needed.",
      agentId: escalation.agentId,
      escalationId: escalation.id,
      createdAt: escalation.escalatedAt,
      ...(insightSummary && insightSuggestion
        ? {
            insight: {
              summary: insightSummary,
              suggestion: insightSuggestion,
              classification: escalation.insightClassification ?? "isolated_incident",
            },
          }
        : {}),
    });
  }

  for (const agent of monitoringAgents) {
    if (agent.presence !== "not_ready") continue;
    if (escalatedAgentIds.has(agent.agentId)) continue;
    if (!agent.presenceUpdatedAt) continue;

    const notReadyForMs = nowMs - new Date(agent.presenceUpdatedAt).getTime();
    if (notReadyForMs < supervisorNotReadyMs) continue;

    const activeCount = (capacityByAgent.get(agent.agentId) ?? []).reduce(
      (sum, row) => sum + Number(row.active_count),
      0,
    );
    if (activeCount > 0) continue;

    alerts.push({
      id: `not-ready-extended-${agent.agentId}`,
      type: "agent_not_ready_extended",
      severity: "warning",
      title: `${agent.name} still Not Ready`,
      detail: `Not Ready for ${Math.floor(notReadyForMs / 60_000)} minutes with no active conversations`,
      agentId: agent.agentId,
      createdAt: new Date(
        new Date(agent.presenceUpdatedAt).getTime() + supervisorNotReadyMs,
      ).toISOString(),
    });
  }

  const proactiveAttempts = dedupeProactiveAttemptsForSupervisorAlerts(
    await listUnacknowledgedProactiveAttempts(db, organizationId, 20),
  );
  for (const attempt of proactiveAttempts) {
    alerts.push({
      id: `coworker-callback-${attempt.id}`,
      type: "coworker_callback_assigned",
      severity: "info",
      title: "Co-worker assigned callback",
      detail: `${attempt.customerName ?? "Customer"} · ${attempt.channel ?? "channel"}${
        attempt.assignedAgentName ? ` → ${attempt.assignedAgentName}` : ""
      }`,
      attemptId: attempt.id,
      taskId: attempt.taskId ?? attempt.id,
      contactId: attempt.contactId ?? undefined,
      queueId: attempt.queueId ?? undefined,
      channel: attempt.channel ?? undefined,
      missedContactId: attempt.missedContactId,
      createdAt: attempt.createdAt,
    });
  }

  const queueNameById = new Map(queues.map((queue) => [queue.id, queue.name]));
  const presentTodayIds = await loadPresentAgentIdsToday(db, organizationId);

  const agents = monitoringAgents.map((agent) => {
    const queueNames = (agent.queueIds ?? [])
      .map((queueId) => queueNameById.get(queueId))
      .filter((name): name is string => Boolean(name));
    if (queueNames.length === 0 && agent.queueName) {
      queueNames.push(agent.queueName);
    }

    return {
      id: agent.id,
      agentId: agent.agentId,
      name: agent.name,
      email: agent.email ?? "",
      workEmail: agent.workEmail ?? null,
      employeeId: agent.employeeId ?? null,
      firstName: agent.firstName ?? null,
      lastName: agent.lastName ?? null,
      teamName: agent.teamName ?? null,
      skills: agent.skills ?? [],
      shiftTypes: agent.shiftTypes ?? [],
      primaryLanguage: agent.primaryLanguage ?? null,
      secondaryLanguage: agent.secondaryLanguage ?? null,
      location: agent.location ?? null,
      accountStatus: agent.accountStatus ?? null,
      agentStatus: agent.agentStatus ?? "active",
      presenceUpdatedAt: agent.presenceUpdatedAt ?? null,
      presence: agent.presence,
      loggedIn: agent.loggedIn ?? isLoggedInPresenceState(agent.presence),
      attendanceToday: presentTodayIds.has(agent.agentId) ? ("present" as const) : ("absent" as const),
      canReceiveCallback: !adminUserIds.has(agent.id),
      queueNames,
      capacity: (capacityByAgent.get(agent.agentId) ?? []).map((row) => ({
        channel: row.channel,
        active: Number(row.active_count),
        reserved: Number(row.reserved_count),
        max: Number(row.max_concurrency),
      })),
      previousConversations: previousByAgent.get(agent.agentId) ?? [],
    };
  });

  return {
    generatedAt: new Date().toISOString(),
    summary: {
      waiting: waitingCount,
      active,
      botActive,
      readyAgents,
      loggedInAgents,
      slaAtRisk: Number(slaSummary[0]?.at_risk ?? 0n),
      slaBreached: Number(slaSummary[0]?.breached ?? 0n),
      offersRinging: offersCount,
    },
    queues,
    agents,
    conversations,
    waiting: waitingInteractions,
    missed,
    callbacks,
    alerts: [
      ...alerts.slice(0, 20),
      ...(await listVeryNegativeSentimentAlerts(db, organizationId)),
    ],
  };
}

type AgentLogoutRow = {
  email: string | null;
  work_email: string | null;
  setup_user_id: string | bigint | null;
};

const adminPresenceStates = ["ready", "not_ready"] as const;
export type AdminPresenceState = (typeof adminPresenceStates)[number];

export async function adminSetAgentPresence(
  db: DbClient,
  organizationId: string,
  agentId: string,
  presence: AdminPresenceState,
): Promise<{ ok: true; presence: AdminPresenceState }> {
  if (!isEntityId(agentId)) {
    throw Object.assign(new Error("Invalid agent id"), { status: 400 });
  }

  const rows = await db.$queryRaw<AgentLogoutRow[]>`
    SELECT a.email, su.work_email, a.setup_user_id
    FROM ccass.agents a
    LEFT JOIN accounts.setup_users su ON su.id = a.setup_user_id
    WHERE a.id = ${agentId}::bigint
      AND a.organization_id = ${organizationId}::bigint
    LIMIT 1
  `;
  const agent = rows[0];
  if (!agent) {
    throw Object.assign(new Error("Agent not found"), { status: 404 });
  }

  const currentPresence = await resolveAgentPresenceState(db, organizationId, agentId);
  if (!isLoggedInPresenceState(currentPresence)) {
    throw Object.assign(new Error("Agent is not logged in"), { status: 400 });
  }

  await setAgentPresenceByAgentId(db, organizationId, agentId, presence, {
    userId: agent.setup_user_id == null ? null : serializeEntityId(agent.setup_user_id),
    reasonCode: presence === "not_ready" ? "supervisor_set" : null,
    source: "admin",
  });

  return { ok: true, presence };
}

export async function adminLogoutAgent(
  db: DbClient,
  prisma: PrismaClient,
  organizationId: string,
  agentId: string,
): Promise<{ ok: true }> {
  if (!isEntityId(agentId)) {
    throw Object.assign(new Error("Invalid agent id"), { status: 400 });
  }

  const rows = await db.$queryRaw<AgentLogoutRow[]>`
    SELECT a.email, su.work_email, a.setup_user_id
    FROM ccass.agents a
    LEFT JOIN accounts.setup_users su ON su.id = a.setup_user_id
    WHERE a.id = ${agentId}::bigint
      AND a.organization_id = ${organizationId}::bigint
    LIMIT 1
  `;
  const agent = rows[0];
  if (!agent) {
    throw Object.assign(new Error("Agent not found"), { status: 404 });
  }

  const presence = await resolveAgentPresenceState(db, organizationId, agentId);
  if (!isLoggedInPresenceState(presence)) {
    throw Object.assign(new Error("Agent is not logged in"), { status: 400 });
  }

  const email = (agent.work_email ?? agent.email)?.trim();
  if (email) {
    await revokeAuthSessionsForEmail(prisma, email);
  }

  await setAgentPresenceByAgentId(db, organizationId, agentId, "offline", {
    userId: agent.setup_user_id == null ? null : serializeEntityId(agent.setup_user_id),
    reasonCode: "admin_logout",
    source: "admin",
  });

  return { ok: true };
}
