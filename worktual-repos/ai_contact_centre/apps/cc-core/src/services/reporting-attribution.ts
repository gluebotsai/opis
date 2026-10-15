import { isEntityId } from "../lib/id-schema.js";

/** Best-effort timestamp for performance period filters when assigned_at was cleared. */
export const REPORTING_PERIOD_AT =
  "COALESCE(c.assigned_at, c.resolved_at, c.ended_at, c.created_at)";

export function assertReportingEntityId(value: string, label: string): string {
  if (!isEntityId(value)) {
    throw new Error(`Invalid ${label} for reporting scope.`);
  }
  return value;
}

/** Matches inbox closed-tab ownership: direct assignment or accepted/ended assignment history. */
/** Conversation reached a live agent (direct assignment or accepted/ended offer). */
export const CONVERSATION_REACHED_AGENT_CONDITION = `(
  c.assigned_user_id IS NOT NULL
  OR EXISTS (
    SELECT 1
    FROM ccass.conversation_assignments ca
    WHERE ca.conversation_id = c.id
      AND ca.organization_id = c.organization_id
      AND ca.state IN ('accepted', 'ended')
  )
)`;

export function conversationHandledByUserCondition(userId: string): string {
  assertReportingEntityId(userId, "user id");
  return `(
    c.assigned_user_id = '${userId}'::bigint
    OR EXISTS (
      SELECT 1
      FROM ccass.conversation_assignments ca
      INNER JOIN ccass.agents a ON a.id = ca.agent_id
      WHERE ca.conversation_id = c.id
        AND ca.organization_id = c.organization_id
        AND a.setup_user_id = '${userId}'::bigint
        AND ca.state IN ('accepted', 'ended')
    )
  )`;
}

export function agentScopedConversationsCte(organizationId: string, userId: string): string {
  assertReportingEntityId(organizationId, "organization id");
  return `__agent_conversations AS (
  SELECT c.*
  FROM ccass.conversations c
  WHERE c.organization_id = '${organizationId}'::bigint
    AND ${conversationHandledByUserCondition(userId)}
)`;
}
