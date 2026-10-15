import type { DbClient } from "../lib/rls.js";
import { serializeEntityId, serializeEntityIdOptional } from "../lib/id-schema.js";

export type ProactiveAttemptStatus = "planned" | "assigned" | "skipped" | "failed";

export type ProactiveCallbackAttemptRecord = {
  id: string;
  missedContactId: string;
  organizationId: string;
  queueId: string | null;
  conversationId: string | null;
  contactId: string | null;
  status: ProactiveAttemptStatus;
  taskId: string | null;
  planJson: Record<string, unknown>;
  errorMessage: string | null;
  acknowledgedAt: string | null;
  createdAt: string;
  updatedAt: string;
};

type AttemptRow = {
  id: string | bigint;
  organization_id: string | bigint;
  missed_contact_id: string | bigint;
  queue_id: string | bigint | null;
  conversation_id: string | bigint | null;
  contact_id: string | bigint | null;
  status: string;
  task_id: string | bigint | null;
  plan_json: Record<string, unknown> | null;
  error_message: string | null;
  acknowledged_at: Date | null;
  created_at: Date;
  updated_at: Date;
};

function mapAttempt(row: AttemptRow): ProactiveCallbackAttemptRecord {
  return {
    id: serializeEntityId(row.id),
    organizationId: serializeEntityId(row.organization_id),
    missedContactId: serializeEntityId(row.missed_contact_id),
    queueId: serializeEntityIdOptional(row.queue_id),
    conversationId: serializeEntityIdOptional(row.conversation_id),
    contactId: serializeEntityIdOptional(row.contact_id),
    status: row.status as ProactiveAttemptStatus,
    taskId: serializeEntityIdOptional(row.task_id),
    planJson: row.plan_json ?? {},
    errorMessage: row.error_message,
    acknowledgedAt: row.acknowledged_at?.toISOString() ?? null,
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
  };
}

function isMissingAttemptsTable(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  const details = error as Error & { meta?: { code?: string; message?: string } };
  return (
    details.meta?.code === "42P01" ||
    /proactive_callback_attempts.*does not exist/i.test(
      `${error.message} ${details.meta?.message ?? ""}`,
    )
  );
}

export async function insertProactiveAttemptPlanned(
  db: DbClient,
  input: {
    organizationId: string;
    missedContactId: string;
    queueId: string | null;
    conversationId: string | null;
    contactId: string | null;
  },
): Promise<ProactiveCallbackAttemptRecord | null> {
  try {
    const rows = await db.$queryRaw<AttemptRow[]>`
      INSERT INTO ccass.proactive_callback_attempts (
        organization_id,
        missed_contact_id,
        queue_id,
        conversation_id,
        contact_id,
        status
      )
      VALUES (
        ${input.organizationId}::bigint,
        ${input.missedContactId}::bigint,
        ${input.queueId}::bigint,
        ${input.conversationId}::bigint,
        ${input.contactId},
        'planned'
      )
      ON CONFLICT (missed_contact_id) DO NOTHING
      RETURNING *
    `;
    const row = rows[0];
    return row ? mapAttempt(row) : null;
  } catch (error) {
    if (isMissingAttemptsTable(error)) return null;
    throw error;
  }
}

export async function updateProactiveAttempt(
  db: DbClient,
  organizationId: string,
  attemptId: string,
  patch: {
    status?: ProactiveAttemptStatus;
    taskId?: string | null;
    planJson?: Record<string, unknown>;
    errorMessage?: string | null;
  },
): Promise<void> {
  try {
    await db.$executeRaw`
      UPDATE ccass.proactive_callback_attempts
      SET status = COALESCE(${patch.status ?? null}, status),
          task_id = COALESCE(${patch.taskId ?? null}::bigint, task_id),
          plan_json = COALESCE(${patch.planJson ?? null}, plan_json),
          error_message = COALESCE(${patch.errorMessage ?? null}, error_message),
          updated_at = NOW()
      WHERE organization_id = ${organizationId}::bigint
        AND id = ${attemptId}::bigint
    `;
  } catch (error) {
    if (isMissingAttemptsTable(error)) return;
    throw error;
  }
}

type ProactiveAttemptAlertRow = ProactiveCallbackAttemptRecord & {
  customerName: string | null;
  channel: string | null;
  assignedAgentName: string | null;
};

/** One supervisor alert per callback task (multiple misses can share one task). */
export function dedupeProactiveAttemptsForSupervisorAlerts<T extends ProactiveAttemptAlertRow>(
  attempts: T[],
): T[] {
  const seen = new Set<string>();
  const deduped: T[] = [];
  for (const attempt of attempts) {
    const key = attempt.taskId
      ? `task:${attempt.taskId}`
      : attempt.contactId
        ? `contact:${attempt.contactId}`
        : `attempt:${attempt.id}`;
    if (seen.has(key)) continue;
    seen.add(key);
    deduped.push(attempt);
  }
  return deduped;
}

export async function listUnacknowledgedProactiveAttempts(
  db: DbClient,
  organizationId: string,
  limit = 20,
): Promise<
  Array<
    ProactiveCallbackAttemptRecord & {
      customerName: string | null;
      channel: string | null;
      assignedAgentName: string | null;
    }
  >
> {
  try {
    const rows = await db.$queryRaw<
      Array<
        AttemptRow & {
          customer_name: string | null;
          channel: string | null;
          assigned_agent_name: string | null;
        }
      >
    >`
      SELECT
        p.*,
        mc.customer_name,
        mc.channel,
        COALESCE(
          a.display_name,
          NULLIF(TRIM(CONCAT(u.first_name, ' ', u.last_name)), '')
        ) AS assigned_agent_name
      FROM ccass.proactive_callback_attempts p
      LEFT JOIN ccass.agent_missed_contacts mc
        ON mc.id = p.missed_contact_id
       AND mc.organization_id = p.organization_id
      LEFT JOIN ccass.agent_tasks t
        ON t.id = p.task_id
       AND t.organization_id = p.organization_id
      LEFT JOIN accounts.setup_users u
        ON u.id = t.assigned_user_id
       AND u.organization_id = t.organization_id
      LEFT JOIN ccass.agents a
        ON a.setup_user_id = t.assigned_user_id
       AND a.organization_id = t.organization_id
      WHERE p.organization_id = ${organizationId}::bigint
        AND p.status = 'assigned'
        AND p.acknowledged_at IS NULL
        AND p.created_at >= NOW() - INTERVAL '7 days'
      ORDER BY p.created_at DESC
      LIMIT ${limit}
    `;
    return rows.map((row) => ({
      ...mapAttempt(row),
      customerName: row.customer_name,
      channel: row.channel,
      assignedAgentName: row.assigned_agent_name?.trim() || null,
    }));
  } catch (error) {
    if (isMissingAttemptsTable(error)) return [];
    throw error;
  }
}

export async function acknowledgeProactiveAttempt(
  db: DbClient,
  organizationId: string,
  attemptId: string,
): Promise<void> {
  try {
    const taskRows = await db.$queryRaw<Array<{ task_id: string | bigint | null }>>`
      SELECT task_id
      FROM ccass.proactive_callback_attempts
      WHERE organization_id = ${organizationId}::bigint
        AND id = ${attemptId}::bigint
      LIMIT 1
    `;
    const taskId = taskRows[0]?.task_id ?? null;

    if (taskId != null) {
      await db.$executeRaw`
        UPDATE ccass.proactive_callback_attempts
        SET acknowledged_at = NOW(),
            updated_at = NOW()
        WHERE organization_id = ${organizationId}::bigint
          AND task_id = ${taskId}::bigint
          AND acknowledged_at IS NULL
      `;
      return;
    }

    await db.$executeRaw`
      UPDATE ccass.proactive_callback_attempts
      SET acknowledged_at = NOW(),
          updated_at = NOW()
      WHERE organization_id = ${organizationId}::bigint
        AND id = ${attemptId}::bigint
        AND acknowledged_at IS NULL
    `;
  } catch (error) {
    if (isMissingAttemptsTable(error)) return;
    throw error;
  }
}
