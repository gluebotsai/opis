import type { DbClient } from "../lib/rls.js";
import { SQL_CONVERSATION_TO_CDP_CONTACT } from "../lib/sql-uuid.js";
import { serializeEntityIdOptional } from "../lib/id-schema.js";
import { formatPersonDisplayName } from "../lib/person-display-name.js";
import { IDENTITY_KEY_TYPES } from "./cdp-customer-profile.js";
import { refreshPreferredChannel } from "./preferred-channel.js";
import type { ConversationRecord } from "./conversations.js";

export const MISSED_CONTACT_REASONS = ["offer_timeout", "no_agent_available"] as const;
export type MissedContactReason = (typeof MISSED_CONTACT_REASONS)[number];

/** Fold legacy stored codes onto the two missed-contact reasons. */
export function normalizeMissedContactReason(value: string): MissedContactReason {
  if (value === "no_agent_available" || value === "routing_exhausted") {
    return "no_agent_available";
  }
  return "offer_timeout";
}

export function mapHandoffFailureReason(_reasonCode: string): MissedContactReason {
  return "no_agent_available";
}

export type AgentMissedContactRecord = {
  id: string;
  conversationId: string;
  contactId: string | null;
  queueId: string | null;
  channel: string;
  reason: MissedContactReason;
  customerName: string;
  customerEmail: string | null;
  customerPhone: string | null;
  offeredAt: string | null;
  missedAt: string;
  acknowledgedAt: string | null;
};

type MissedContactRow = {
  id: string;
  conversation_id: string;
  contact_id: string | null;
  queue_id: string | null;
  channel: string;
  reason: string;
  customer_name: string;
  customer_email: string | null;
  customer_phone: string | null;
  offered_at: Date | null;
  missed_at: Date;
  acknowledged_at: Date | null;
};

type CustomerSnapshot = {
  customerName: string;
  customerEmail: string | null;
  customerPhone: string | null;
};

function mapMissedContact(row: MissedContactRow): AgentMissedContactRecord {
  return {
    id: serializeEntityIdOptional(row.id)!,
    conversationId: serializeEntityIdOptional(row.conversation_id)!,
    contactId: serializeEntityIdOptional(row.contact_id),
    queueId: serializeEntityIdOptional(row.queue_id),
    channel: row.channel,
    reason: normalizeMissedContactReason(row.reason),
    customerName: row.customer_name,
    customerEmail: row.customer_email,
    customerPhone: row.customer_phone,
    offeredAt: row.offered_at?.toISOString() ?? null,
    missedAt: row.missed_at.toISOString(),
    acknowledgedAt: row.acknowledged_at?.toISOString() ?? null,
  };
}

function formatVisitorName(visitorId: string | null): string {
  if (!visitorId?.trim()) return "Visitor";
  const trimmed = visitorId.trim();
  if (/^v_/i.test(trimmed)) return `Visitor ${trimmed.slice(2)}`;
  return `Visitor ${trimmed}`;
}

async function resolveCustomerSnapshot(
  db: DbClient,
  organizationId: string,
  conversation: ConversationRecord,
): Promise<CustomerSnapshot> {
  if (!conversation.contactId) {
    return {
      customerName: formatVisitorName(conversation.visitorId),
      customerEmail: null,
      customerPhone: null,
    };
  }

  const rows = await db.$queryRawUnsafe<
    Array<{
      first_name: string | null;
      last_name: string | null;
      email: string | null;
      phone: string | null;
    }>
  >(
    `
    SELECT
      cp.first_name,
      cp.last_name,
      email_ik.key_value AS email,
      phone_ik.key_value AS phone
    FROM ccass.conversations c
    LEFT JOIN cdp.customer_profile cp
      ON ${SQL_CONVERSATION_TO_CDP_CONTACT}
     AND cp.organization_id = c.organization_id
    LEFT JOIN LATERAL (
      SELECT key_value
      FROM cdp.identity_keys
      WHERE cdp_id = c.contact_id
        AND organization_id = c.organization_id
        AND key_type IN ('${IDENTITY_KEY_TYPES.EMAIL}', '${IDENTITY_KEY_TYPES.EMAIL_SECONDARY}')
      LIMIT 1
    ) email_ik ON TRUE
    LEFT JOIN LATERAL (
      SELECT key_value
      FROM cdp.identity_keys
      WHERE cdp_id = c.contact_id
        AND organization_id = c.organization_id
        AND key_type IN (
          '${IDENTITY_KEY_TYPES.PHONE}',
          '${IDENTITY_KEY_TYPES.PHONE_SECONDARY}',
          '${IDENTITY_KEY_TYPES.WHATSAPP_PHONE}'
        )
      LIMIT 1
    ) phone_ik ON TRUE
    WHERE c.id = $1::bigint
      AND c.organization_id = $2::bigint
    LIMIT 1
    `,
    conversation.id,
    organizationId,
  );

  const row = rows[0];
  return {
    customerName:
      formatPersonDisplayName({
        firstName: row?.first_name,
        lastName: row?.last_name,
        visitorId: conversation.visitorId,
      }) || formatVisitorName(conversation.visitorId),
    customerEmail: row?.email ?? null,
    customerPhone: row?.phone ?? null,
  };
}

export async function recordAgentMissedContact(
  db: DbClient,
  organizationId: string,
  input: {
    agentId: string;
    assignedUserId: string;
    conversation: ConversationRecord;
    assignmentId?: string | null;
    queueId?: string | null;
    offeredAt?: Date | null;
    reason?: MissedContactReason;
  },
): Promise<AgentMissedContactRecord | null> {
  const customer = await resolveCustomerSnapshot(db, organizationId, input.conversation);
  const reason = input.reason ?? "offer_timeout";

  const rows = await db.$queryRaw<MissedContactRow[]>`
    INSERT INTO ccass.agent_missed_contacts (
      organization_id,
      agent_id,
      assigned_user_id,
      conversation_id,
      assignment_id,
      contact_id,
      queue_id,
      channel,
      reason,
      customer_name,
      customer_email,
      customer_phone,
      offered_at
    )
    VALUES (
      ${organizationId}::bigint,
      ${input.agentId}::bigint,
      ${input.assignedUserId}::bigint,
      ${input.conversation.id}::bigint,
      ${input.assignmentId ?? null}::bigint,
      ${input.conversation.contactId ?? null},
      ${input.queueId ?? input.conversation.queueId ?? null}::bigint,
      ${input.conversation.channel},
      ${reason},
      ${customer.customerName},
      ${customer.customerEmail},
      ${customer.customerPhone},
      ${input.offeredAt ?? null}
    )
    ON CONFLICT (assignment_id) WHERE assignment_id IS NOT NULL DO NOTHING
    RETURNING
      id,
      conversation_id,
      contact_id,
      queue_id,
      channel,
      reason,
      customer_name,
      customer_email,
      customer_phone,
      offered_at,
      missed_at,
      acknowledged_at
  `;

  if (rows[0]) {
    if (input.conversation.contactId) {
      await refreshPreferredChannel(
        db,
        organizationId,
        input.conversation.contactId,
        input.conversation.channel,
      );
    }
    return mapMissedContact(rows[0]);
  }

  return null;
}

export async function listAgentMissedContacts(
  db: DbClient,
  organizationId: string,
  userId: string,
  options: { limit?: number; unreadOnly?: boolean } = {},
): Promise<{ items: AgentMissedContactRecord[]; unreadCount: number }> {
  const limit = Math.min(Math.max(options.limit ?? 20, 1), 100);

  const countRows = await db.$queryRaw<{ unread_count: number }[]>`
    SELECT COUNT(*)::int AS unread_count
    FROM ccass.agent_missed_contacts
    WHERE organization_id = ${organizationId}::bigint
      AND assigned_user_id = ${userId}::bigint
      AND acknowledged_at IS NULL
  `;

  const rows = await db.$queryRaw<MissedContactRow[]>`
    SELECT
      id,
      conversation_id,
      contact_id,
      queue_id,
      channel,
      reason,
      customer_name,
      customer_email,
      customer_phone,
      offered_at,
      missed_at,
      acknowledged_at
    FROM ccass.agent_missed_contacts
    WHERE organization_id = ${organizationId}::bigint
      AND assigned_user_id = ${userId}::bigint
      AND (${options.unreadOnly ?? false} = FALSE OR acknowledged_at IS NULL)
    ORDER BY missed_at DESC
    LIMIT ${limit}
  `;

  return {
    items: rows.map(mapMissedContact),
    unreadCount: countRows[0]?.unread_count ?? 0,
  };
}

export async function acknowledgeMissedContactsForCallback(
  db: DbClient,
  organizationId: string,
  input: { conversationId?: string | null; contactId?: string | null; channel?: string | null },
): Promise<number> {
  if (!input.conversationId && !input.contactId) {
    return 0;
  }

  const rows = await db.$queryRaw<{ updated_count: number }[]>`
    WITH updated AS (
      UPDATE ccass.agent_missed_contacts mc
      SET acknowledged_at = COALESCE(mc.acknowledged_at, NOW())
      WHERE mc.organization_id = ${organizationId}::bigint
        AND mc.acknowledged_at IS NULL
        AND (
          (${input.conversationId ?? null}::bigint IS NOT NULL AND mc.conversation_id = ${input.conversationId ?? null}::bigint)
          OR (
            ${input.contactId ?? null}::text IS NOT NULL
            AND mc.contact_id = ${input.contactId ?? null}
            AND (${input.channel ?? null}::text IS NULL OR mc.channel = ${input.channel ?? null})
          )
          OR (
            ${input.contactId ?? null}::text IS NOT NULL
            AND EXISTS (
              SELECT 1
              FROM cdp.identity_keys callback_ik
              INNER JOIN cdp.identity_keys missed_ik
                ON missed_ik.organization_id = callback_ik.organization_id
               AND missed_ik.key_type = callback_ik.key_type
               AND missed_ik.key_value = callback_ik.key_value
              WHERE callback_ik.organization_id = mc.organization_id
                AND callback_ik.cdp_id = ${input.contactId ?? null}::text
                AND missed_ik.cdp_id = mc.contact_id
                AND callback_ik.key_type IN (
                  ${IDENTITY_KEY_TYPES.EMAIL},
                  ${IDENTITY_KEY_TYPES.EMAIL_SECONDARY},
                  ${IDENTITY_KEY_TYPES.PHONE},
                  ${IDENTITY_KEY_TYPES.PHONE_SECONDARY},
                  ${IDENTITY_KEY_TYPES.WHATSAPP_PHONE},
                  ${IDENTITY_KEY_TYPES.WEBCHAT_VISITOR},
                  ${IDENTITY_KEY_TYPES.INSTAGRAM_USER},
                  ${IDENTITY_KEY_TYPES.FACEBOOK_USER}
                )
            )
            AND (${input.channel ?? null}::text IS NULL OR mc.channel = ${input.channel ?? null})
          )
        )
      RETURNING mc.id
    )
    SELECT COUNT(*)::int AS updated_count FROM updated
  `;
  return rows[0]?.updated_count ?? 0;
}

export async function acknowledgeAgentMissedContact(
  db: DbClient,
  organizationId: string,
  userId: string,
  missedContactId: string,
): Promise<AgentMissedContactRecord | null> {
  const rows = await db.$queryRaw<MissedContactRow[]>`
    UPDATE ccass.agent_missed_contacts
    SET acknowledged_at = COALESCE(acknowledged_at, NOW())
    WHERE id = ${missedContactId}::bigint
      AND organization_id = ${organizationId}::bigint
      AND assigned_user_id = ${userId}::bigint
    RETURNING
      id,
      conversation_id,
      contact_id,
      queue_id,
      channel,
      reason,
      customer_name,
      customer_email,
      customer_phone,
      offered_at,
      missed_at,
      acknowledged_at
  `;
  const row = rows[0];
  return row ? mapMissedContact(row) : null;
}

export function missedContactEpisodeBoundary(
  queuedAt: string | null,
  now: Date = new Date(),
): Date {
  if (queuedAt) {
    const parsed = new Date(queuedAt);
    if (Number.isFinite(parsed.getTime())) return parsed;
  }
  return new Date(now.getTime() - 24 * 60 * 60 * 1000);
}

/**
 * Record a missed/abandoned handoff when routing fails before any agent offer
 * (e.g. all agents offline/not ready).
 */
export async function recordHandoffFailureMissedContact(
  db: DbClient,
  organizationId: string,
  input: {
    conversation: ConversationRecord;
    queueId?: string | null;
    reasonCode: string;
    offeredAt?: Date | null;
  },
): Promise<AgentMissedContactRecord | null> {
  const reason = mapHandoffFailureReason(input.reasonCode);
  const customer = await resolveCustomerSnapshot(db, organizationId, input.conversation);
  const episodeStartedAt = missedContactEpisodeBoundary(input.conversation.queuedAt);

  const recentRows = await db.$queryRaw<
    Array<{ id: string; missed_at: Date; connected_after_miss: boolean }>
  >`
    SELECT
      mc.id,
      mc.missed_at,
      EXISTS (
        SELECT 1
        FROM ccass.conversations c
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
      ) AS connected_after_miss
    FROM ccass.agent_missed_contacts mc
    WHERE mc.organization_id = ${organizationId}::bigint
      AND mc.conversation_id = ${input.conversation.id}::bigint
      AND mc.missed_at >= ${episodeStartedAt}
    ORDER BY mc.missed_at DESC
    LIMIT 1
  `;
  const recent = recentRows[0];
  // An agent offer timeout already represents this failed customer handoff.
  // Do not add a second no-agent/routing-exhausted row for the same episode.
  // A later customer retry has a newer queued_at boundary and remains eligible.
  if (recent && !recent.connected_after_miss) {
    return null;
  }

  const rows = await db.$queryRaw<MissedContactRow[]>`
    INSERT INTO ccass.agent_missed_contacts (
      organization_id,
      agent_id,
      assigned_user_id,
      conversation_id,
      assignment_id,
      contact_id,
      queue_id,
      channel,
      reason,
      customer_name,
      customer_email,
      customer_phone,
      offered_at,
      metadata
    )
    VALUES (
      ${organizationId}::bigint,
      NULL,
      NULL,
      ${input.conversation.id}::bigint,
      NULL,
      ${input.conversation.contactId ?? null},
      ${input.queueId ?? input.conversation.queueId ?? null}::bigint,
      ${input.conversation.channel},
      ${reason},
      ${customer.customerName},
      ${customer.customerEmail},
      ${customer.customerPhone},
      ${input.offeredAt ?? (input.conversation.queuedAt ? new Date(input.conversation.queuedAt) : null)},
      ${JSON.stringify({ reasonCode: input.reasonCode })}::jsonb
    )
    RETURNING
      id,
      conversation_id,
      contact_id,
      queue_id,
      channel,
      reason,
      customer_name,
      customer_email,
      customer_phone,
      offered_at,
      missed_at,
      acknowledged_at
  `;

  if (rows[0]) {
    if (input.conversation.contactId) {
      await refreshPreferredChannel(
        db,
        organizationId,
        input.conversation.contactId,
        input.conversation.channel,
      );
    }
    return mapMissedContact(rows[0]);
  }

  return null;
}

export async function acknowledgeAllAgentMissedContacts(
  db: DbClient,
  organizationId: string,
  userId: string,
): Promise<number> {
  const rows = await db.$queryRaw<{ updated_count: number }[]>`
    WITH updated AS (
      UPDATE ccass.agent_missed_contacts
      SET acknowledged_at = NOW()
      WHERE organization_id = ${organizationId}::bigint
        AND assigned_user_id = ${userId}::bigint
        AND acknowledged_at IS NULL
      RETURNING id
    )
    SELECT COUNT(*)::int AS updated_count FROM updated
  `;
  return rows[0]?.updated_count ?? 0;
}

export async function countMissedContactsForPerformance(
  db: DbClient,
  organizationId: string,
  userId: string,
  start: Date,
  end: Date,
): Promise<number> {
  const rows = await db.$queryRaw<{ missed_count: number }[]>`
    SELECT COUNT(*)::int AS missed_count
    FROM ccass.agent_missed_contacts mc
    WHERE mc.organization_id = ${organizationId}::bigint
      AND mc.assigned_user_id = ${userId}::bigint
      AND mc.missed_at >= ${start}
      AND mc.missed_at < ${end}
  `;
  return rows[0]?.missed_count ?? 0;
}
