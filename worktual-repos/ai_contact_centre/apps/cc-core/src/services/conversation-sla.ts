import type { DbClient } from "../lib/rls.js";

export type ConversationSlaState = {
  conversationId: string;
  slaPolicyId: string | null;
  firstResponseDueAt: string | null;
  resolutionDueAt: string | null;
  firstResponseWarningAt: string | null;
  resolutionWarningAt: string | null;
  breachedAt: string | null;
};

/**
 * Start first-response and resolution SLA clocks when a conversation enters queue.
 */
export async function startConversationSla(
  db: DbClient,
  organizationId: string,
  conversationId: string,
  queueId: string | null,
): Promise<ConversationSlaState | null> {
  if (!queueId) return null;

  const policyRows = await db.$queryRaw<
    {
      id: string;
      first_response_seconds: number;
      resolution_seconds: number;
      warning_threshold_pct: number;
    }[]
  >`
    SELECT sp.id, sp.first_response_seconds, sp.resolution_seconds, sp.warning_threshold_pct
    FROM ccass.sla_policies sp
    LEFT JOIN ccass.routing_policies rp ON rp.organization_id = sp.organization_id
    WHERE sp.organization_id = ${organizationId}::bigint
      AND sp.is_active = TRUE
      AND (rp.queue_id = ${queueId}::bigint OR rp.queue_id IS NULL)
    ORDER BY CASE WHEN rp.queue_id = ${queueId}::bigint THEN 0 ELSE 1 END, sp.updated_at DESC
    LIMIT 1
  `;
  const policy = policyRows[0];
  if (!policy) return null;

  const warningPct = Math.min(Math.max(policy.warning_threshold_pct, 1), 99) / 100;
  const rows = await db.$queryRaw<
    {
      conversation_id: string;
      sla_policy_id: string | null;
      first_response_due_at: Date | null;
      resolution_due_at: Date | null;
      first_response_warning_at: Date | null;
      resolution_warning_at: Date | null;
      breached_at: Date | null;
    }[]
  >`
    INSERT INTO ccass.conversation_sla_state (
      organization_id, conversation_id, sla_policy_id,
      first_response_due_at, resolution_due_at,
      first_response_warning_at, resolution_warning_at, updated_at
    ) VALUES (
      ${organizationId}::bigint,
      ${conversationId}::bigint,
      ${policy.id}::bigint,
      NOW() + (${policy.first_response_seconds} || ' seconds')::interval,
      NOW() + (${policy.resolution_seconds} || ' seconds')::interval,
      NOW() + ((${Math.floor(policy.first_response_seconds * warningPct)}) || ' seconds')::interval,
      NOW() + ((${Math.floor(policy.resolution_seconds * warningPct)}) || ' seconds')::interval,
      NOW()
    )
    ON CONFLICT (conversation_id) DO UPDATE
      SET
        sla_policy_id = EXCLUDED.sla_policy_id,
        first_response_due_at = COALESCE(ccass.conversation_sla_state.first_response_due_at, EXCLUDED.first_response_due_at),
        resolution_due_at = COALESCE(ccass.conversation_sla_state.resolution_due_at, EXCLUDED.resolution_due_at),
        first_response_warning_at = COALESCE(ccass.conversation_sla_state.first_response_warning_at, EXCLUDED.first_response_warning_at),
        resolution_warning_at = COALESCE(ccass.conversation_sla_state.resolution_warning_at, EXCLUDED.resolution_warning_at),
        updated_at = NOW()
    RETURNING *
  `;
  const row = rows[0];
  if (!row) return null;
  return {
    conversationId: String(row.conversation_id),
    slaPolicyId: row.sla_policy_id ? String(row.sla_policy_id) : null,
    firstResponseDueAt: row.first_response_due_at?.toISOString() ?? null,
    resolutionDueAt: row.resolution_due_at?.toISOString() ?? null,
    firstResponseWarningAt: row.first_response_warning_at?.toISOString() ?? null,
    resolutionWarningAt: row.resolution_warning_at?.toISOString() ?? null,
    breachedAt: row.breached_at?.toISOString() ?? null,
  };
}

export async function markFirstResponseSlaMet(
  db: DbClient,
  organizationId: string,
  conversationId: string,
): Promise<void> {
  await db.$executeRaw`
    UPDATE ccass.conversation_sla_state
    SET
      first_response_due_at = NULL,
      first_response_warning_at = NULL,
      updated_at = NOW()
    WHERE organization_id = ${organizationId}::bigint
      AND conversation_id = ${conversationId}::bigint
  `;
}

export async function finalizeConversationSla(
  db: DbClient,
  organizationId: string,
  conversationId: string,
): Promise<void> {
  await db.$executeRaw`
    UPDATE ccass.conversation_sla_state
    SET
      first_response_due_at = NULL,
      resolution_due_at = NULL,
      first_response_warning_at = NULL,
      resolution_warning_at = NULL,
      updated_at = NOW()
    WHERE organization_id = ${organizationId}::bigint
      AND conversation_id = ${conversationId}::bigint
  `;
}

export async function sweepSlaBreaches(db: DbClient): Promise<number> {
  const rows = await db.$queryRaw<{ id: string }[]>`
    UPDATE ccass.conversation_sla_state
    SET breached_at = COALESCE(breached_at, NOW()), updated_at = NOW()
    WHERE breached_at IS NULL
      AND (
        (first_response_due_at IS NOT NULL AND first_response_due_at < NOW())
        OR (resolution_due_at IS NOT NULL AND resolution_due_at < NOW())
      )
    RETURNING id
  `;
  return rows.length;
}
