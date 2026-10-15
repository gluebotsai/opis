import type { DbClient } from "../lib/rls.js";
import { serializeEntityIdOptional } from "../lib/id-schema.js";
import { IDENTITY_KEY_TYPES } from "./cdp-customer-profile.js";

/** Identity keys used to treat separate contact records as the same person. */
export const CALLBACK_IDENTITY_KEY_TYPES = [
  IDENTITY_KEY_TYPES.EMAIL,
  IDENTITY_KEY_TYPES.EMAIL_SECONDARY,
  IDENTITY_KEY_TYPES.PHONE,
  IDENTITY_KEY_TYPES.PHONE_SECONDARY,
  IDENTITY_KEY_TYPES.WHATSAPP_PHONE,
  IDENTITY_KEY_TYPES.INSTAGRAM_USER,
  IDENTITY_KEY_TYPES.FACEBOOK_USER,
  IDENTITY_KEY_TYPES.WEBCHAT_VISITOR,
] as const;

const CALLBACK_IDENTITY_KEY_TYPES_SQL = CALLBACK_IDENTITY_KEY_TYPES.map(
  (keyType) => `'${keyType}'`,
).join(", ");

export type OpenCallbackTaskRow = {
  id: string;
  notes: string | null;
  priority: "low" | "normal" | "high" | "critical";
  source: "self" | "admin" | "coworker" | "system";
};

/**
 * Serialize callback creation for one canonical person/conversation. Callers
 * must execute inside a transaction; the lock is released automatically.
 */
export async function lockCallbackCreation(
  db: DbClient,
  organizationId: string,
  input: { contactId?: string | null; conversationId?: string | null },
): Promise<void> {
  const subject = input.contactId
    ? `contact:${input.contactId}`
    : input.conversationId
      ? `conversation:${input.conversationId}`
      : null;
  if (!subject) return;

  await db.$executeRaw`
    SELECT pg_advisory_xact_lock(
      hashtextextended(${`callback:${organizationId}:${subject}`}, 0)
    )
  `;
}

export function buildOpenCallbackMatchSql(taskAlias: string): string {
  return `
    ($3::bigint IS NOT NULL AND ${taskAlias}.conversation_id = $3::bigint)
    OR ($2::text IS NOT NULL AND ${taskAlias}.contact_id = $2::text)
    OR (
      $2::text IS NOT NULL
      AND EXISTS (
        SELECT 1
        FROM cdp.identity_keys candidate_ik
        INNER JOIN cdp.identity_keys task_ik
          ON task_ik.organization_id = candidate_ik.organization_id
         AND task_ik.key_type = candidate_ik.key_type
         AND task_ik.key_value = candidate_ik.key_value
        WHERE candidate_ik.organization_id = $1::bigint
          AND candidate_ik.cdp_id = $2::text
          AND task_ik.cdp_id = ${taskAlias}.contact_id
          AND candidate_ik.key_type IN (${CALLBACK_IDENTITY_KEY_TYPES_SQL})
      )
    )
  `;
}

/** Find an open callback for the same person (contact id or shared identity keys). */
export async function findOpenCallbackTaskForContact(
  db: DbClient,
  organizationId: string,
  input: { contactId?: string | null; conversationId?: string | null },
): Promise<OpenCallbackTaskRow | null> {
  if (!input.contactId && !input.conversationId) {
    return null;
  }

  const matchSql = buildOpenCallbackMatchSql("t");
  const rows = await db.$queryRawUnsafe<OpenCallbackTaskRow[]>(
    `
    SELECT t.id::text AS id, t.notes, t.priority, t.source
    FROM ccass.agent_tasks t
    WHERE t.organization_id = $1::bigint
      AND t.task_type = 'callback'
      AND t.status = 'open'
      AND (
        ${matchSql}
      )
    ORDER BY t.updated_at DESC
    LIMIT 1
    `,
    organizationId,
    input.contactId ?? null,
    input.conversationId ?? null,
  );

  return rows[0] ?? null;
}

/** Dismiss other open callbacks for the same person, keeping the canonical task. */
export async function dismissDuplicateOpenCallbacks(
  db: DbClient,
  organizationId: string,
  canonicalTaskId: string,
  input: { contactId?: string | null; conversationId?: string | null },
): Promise<void> {
  if (!input.contactId && !input.conversationId) {
    return;
  }

  const mergeNote = `\nMerged into callback ${serializeEntityIdOptional(canonicalTaskId)}.`;
  const matchSql = buildOpenCallbackMatchSql("t");
  await db.$executeRawUnsafe(
    `
    UPDATE ccass.agent_tasks t
    SET status = 'dismissed',
        dismissed_at = NOW(),
        notes = COALESCE(notes, '') || $4,
        updated_at = NOW()
    WHERE t.organization_id = $1::bigint
      AND t.task_type = 'callback'
      AND t.status = 'open'
      AND t.id <> $5::bigint
      AND (
        ${matchSql}
      )
    `,
    organizationId,
    input.contactId ?? null,
    input.conversationId ?? null,
    mergeNote,
    canonicalTaskId,
  );
}

function buildDuplicateOpenCallbackExistsSql(oldAlias: string, newAlias: string): string {
  return `
    ${newAlias}.organization_id = ${oldAlias}.organization_id
    AND ${newAlias}.task_type = 'callback'
    AND ${newAlias}.status = 'open'
    AND ${newAlias}.id <> ${oldAlias}.id
    AND (${newAlias}.updated_at, ${newAlias}.id) >
        (${oldAlias}.updated_at, ${oldAlias}.id)
    AND (
      (
        ${oldAlias}.conversation_id IS NOT NULL
        AND ${newAlias}.conversation_id = ${oldAlias}.conversation_id
      )
      OR (
        ${oldAlias}.contact_id IS NOT NULL
        AND ${newAlias}.contact_id = ${oldAlias}.contact_id
      )
      OR (
        ${oldAlias}.contact_id IS NOT NULL
        AND ${newAlias}.contact_id IS NOT NULL
        AND EXISTS (
          SELECT 1
          FROM cdp.identity_keys ik_new
          INNER JOIN cdp.identity_keys ik_old
            ON ik_old.organization_id = ik_new.organization_id
           AND ik_old.key_type = ik_new.key_type
           AND ik_old.key_value = ik_new.key_value
          WHERE ik_new.organization_id = ${newAlias}.organization_id
            AND ik_new.cdp_id = ${newAlias}.contact_id
            AND ik_old.cdp_id = ${oldAlias}.contact_id
            AND ik_new.key_type IN (${CALLBACK_IDENTITY_KEY_TYPES_SQL})
        )
      )
    )
  `;
}

/**
 * Dismiss older open callbacks when a newer one exists for the same person
 * (shared conversation or identity keys).
 */
export async function consolidateDuplicateOpenCallbacks(
  db: DbClient,
  organizationId: string,
): Promise<number> {
  const duplicateExistsSql = buildDuplicateOpenCallbackExistsSql("t_old", "t_new");
  const rows = await db.$queryRawUnsafe<{ updated_count: number }[]>(
    `
    WITH dismissed AS (
      UPDATE ccass.agent_tasks t_old
      SET status = 'dismissed',
          dismissed_at = NOW(),
          notes = COALESCE(t_old.notes, '') || $2,
          updated_at = NOW()
      WHERE t_old.organization_id = $1::bigint
        AND t_old.task_type = 'callback'
        AND t_old.status = 'open'
        AND EXISTS (
          SELECT 1
          FROM ccass.agent_tasks t_new
          WHERE ${duplicateExistsSql}
        )
      RETURNING t_old.id
    )
    SELECT COUNT(*)::int AS updated_count FROM dismissed
    `,
    organizationId,
    "\nMerged into a newer open callback for the same customer.",
  );
  return rows[0]?.updated_count ?? 0;
}

/** SQL predicate for proactive sweeper: missed contact already has an open callback. */
export function buildMissedContactOpenCallbackExistsSql(
  missedAlias: string,
  taskAlias: string,
): string {
  return `
    (
      ${missedAlias}.conversation_id IS NOT NULL
      AND ${taskAlias}.conversation_id = ${missedAlias}.conversation_id
    )
    OR (
      ${missedAlias}.contact_id IS NOT NULL
      AND ${taskAlias}.contact_id = ${missedAlias}.contact_id
    )
    OR (
      ${missedAlias}.contact_id IS NOT NULL
      AND EXISTS (
        SELECT 1
        FROM cdp.identity_keys candidate_ik
        INNER JOIN cdp.identity_keys task_ik
          ON task_ik.organization_id = candidate_ik.organization_id
         AND task_ik.key_type = candidate_ik.key_type
         AND task_ik.key_value = candidate_ik.key_value
        WHERE candidate_ik.organization_id = ${missedAlias}.organization_id
          AND candidate_ik.cdp_id = ${missedAlias}.contact_id
          AND task_ik.cdp_id = ${taskAlias}.contact_id
          AND candidate_ik.key_type IN (${CALLBACK_IDENTITY_KEY_TYPES_SQL})
      )
    )
  `;
}
