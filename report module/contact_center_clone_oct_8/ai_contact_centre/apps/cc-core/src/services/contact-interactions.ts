import type { DbClient } from "../lib/rls.js";
import { serializeEntityIdOptional } from "../lib/id-schema.js";
import {
  IDENTITY_KEY_TYPES,
  PHONE_MATCH_IDENTITY_KEYS,
  findCdpIdByIdentityKey,
} from "./cdp-customer-profile.js";

export type ContactInteractionRecord = {
  id: string;
  conversationId: string;
  messageId: string | null;
  channel: string;
  queueId: string | null;
  subject: string | null;
  status: string;
  summary: string;
  occurredAt: string;
  createdAt: string;
  endedAt: string | null;
  resolvedAt: string | null;
  endReason: string | null;
  dispositionCode: string | null;
  resolutionCode: string | null;
  handoffReason: string | null;
  agentConnected: boolean;
  direction: "inbound" | "outbound";
  botMemory: {
    rollingSummary: string | null;
    extractedFacts: string[];
  } | null;
  sentiment: {
    customerLabel: string;
    customerRationale: string | null;
    summary: string | null;
  } | null;
};

export async function resolveContactByIdentifiers(
  db: DbClient,
  organizationId: string,
  identifiers: { email?: string; phone?: string },
): Promise<{ contactId: string } | null> {
  const email = identifiers.email?.trim().toLowerCase();
  const phone = identifiers.phone?.replace(/\D/g, "");
  if (email) {
    const byPrimary = await findCdpIdByIdentityKey(
      db,
      organizationId,
      IDENTITY_KEY_TYPES.EMAIL,
      email,
    );
    if (byPrimary) return { contactId: byPrimary };
    const bySecondary = await findCdpIdByIdentityKey(
      db,
      organizationId,
      IDENTITY_KEY_TYPES.EMAIL_SECONDARY,
      email,
    );
    if (bySecondary) return { contactId: bySecondary };
  }
  if (phone && phone.length >= 7) {
    for (const keyType of PHONE_MATCH_IDENTITY_KEYS) {
      const contactId = await findCdpIdByIdentityKey(db, organizationId, keyType, phone);
      if (contactId) return { contactId };
    }
  }
  return null;
}

type ContactConversationMatch = {
  contactIds: string[];
};

/** Resolve linked conversation contact ids for a CDP contact (including peer profiles). */
export async function resolveContactConversationMatch(
  db: DbClient,
  organizationId: string,
  contactId: string,
): Promise<ContactConversationMatch> {
  const contactIds = new Set<string>([contactId]);

  const peerRows = await db.$queryRaw<{ cdp_id: string }[]>`
    SELECT DISTINCT ik_peer.cdp_id
    FROM cdp.identity_keys ik_self
    INNER JOIN cdp.identity_keys ik_peer
      ON ik_peer.organization_id = ik_self.organization_id
     AND ik_peer.key_type = ik_self.key_type
     AND ik_peer.key_value = ik_self.key_value
    WHERE ik_self.organization_id = ${organizationId}::bigint
      AND ik_self.cdp_id = ${contactId}::text
  `;

  for (const row of peerRows) {
    contactIds.add(row.cdp_id);
  }

  return { contactIds: [...contactIds] };
}

export async function listContactInteractions(
  db: DbClient,
  organizationId: string,
  contactId: string,
  params: { offset?: number; limit?: number; handledByUserId?: string } = {},
): Promise<{
  interactions: ContactInteractionRecord[];
  total: number;
  offset: number;
  hasMore: boolean;
}> {
  const offset = params.offset ?? 0;
  const limit = params.limit ?? 15;
  const handledByUserId = params.handledByUserId ?? null;
  const contactMatch = await resolveContactConversationMatch(db, organizationId, contactId);
  const hasContactIds = contactMatch.contactIds.length > 0;

  const countRows = await db.$queryRaw<{ count: bigint }[]>`
    SELECT COUNT(*)::bigint AS count
    FROM ccass.conversations c
    WHERE c.organization_id = ${organizationId}::bigint
      AND (
        (${hasContactIds} AND c.contact_id = ANY(${contactMatch.contactIds}::text[]))
        OR EXISTS (
          SELECT 1
          FROM cdp.identity_keys ik
          WHERE ik.organization_id = c.organization_id
            AND ik.cdp_id = ANY(${contactMatch.contactIds}::text[])
            AND (
                (
                  ik.key_type IN (
                    ${IDENTITY_KEY_TYPES.EMAIL},
                    ${IDENTITY_KEY_TYPES.EMAIL_SECONDARY}
                  )
                  AND lower(c.visitor_id) = lower(ik.key_value)
                )
                OR (
                  ik.key_type = ${IDENTITY_KEY_TYPES.WEBCHAT_VISITOR}
                  AND c.visitor_id = ik.key_value
                )
                OR (
                  ik.key_type IN (
                    ${IDENTITY_KEY_TYPES.WHATSAPP_PHONE},
                    ${IDENTITY_KEY_TYPES.PHONE},
                    ${IDENTITY_KEY_TYPES.PHONE_SECONDARY}
                  )
                  AND regexp_replace(COALESCE(c.visitor_id, ''), '\D', '', 'g') = ik.key_value
                )
                OR (
                  ik.key_type IN (
                    ${IDENTITY_KEY_TYPES.INSTAGRAM_USER},
                    ${IDENTITY_KEY_TYPES.FACEBOOK_USER}
                  )
                  AND c.visitor_id = ik.key_value
                )
              )
        )
      )
      AND (
        ${handledByUserId}::bigint IS NULL
        OR c.assigned_user_id = ${handledByUserId}::bigint
        OR EXISTS (
          SELECT 1
          FROM ccass.conversation_assignments ca
          INNER JOIN ccass.agents a
            ON a.id = ca.agent_id
           AND a.organization_id = ca.organization_id
          WHERE ca.conversation_id = c.id
            AND ca.organization_id = c.organization_id
            AND a.setup_user_id = ${handledByUserId}::bigint
            AND ca.state IN ('accepted', 'ended')
        )
      )
  `;
  const total = Number(countRows[0]?.count ?? 0);

  const rows = await db.$queryRaw<
    Array<{
      conversation_id: string;
      message_id: string | null;
      channel: string;
      queue_id: string | null;
      subject: string | null;
      status: string;
      summary: string | null;
      rolling_summary: string | null;
      extracted_facts: unknown;
      occurred_at: Date;
      created_at: Date;
      ended_at: Date | null;
      resolved_at: Date | null;
      end_reason: string | null;
      disposition_code: string | null;
      resolution_code: string | null;
      handoff_reason: string | null;
      agent_connected: boolean;
      direction: string | null;
      customer_sentiment_label: string | null;
      customer_sentiment_rationale: string | null;
      sentiment_summary: string | null;
    }>
  >`
    SELECT
      c.id AS conversation_id,
      anchor.id AS message_id,
      c.channel,
      c.queue_id,
      c.subject,
      c.status,
      c.direction,
      COALESCE(
        NULLIF(trim(mem.rolling_summary), ''),
        NULLIF(trim(i.summary), ''),
        (
          SELECT body
          FROM ccass.conversation_messages preview
          WHERE preview.conversation_id = c.id
            AND preview.organization_id = c.organization_id
          ORDER BY preview.created_at DESC
          LIMIT 1
        ),
        ''
      ) AS summary,
      mem.rolling_summary,
      mem.extracted_facts,
      c.updated_at AS occurred_at,
      c.created_at,
      c.ended_at,
      c.resolved_at,
      c.end_reason,
      c.disposition_code,
      c.resolution_code,
      c.handoff_reason,
      COALESCE(
        c.resolution_data #>> '{sentiment,customer,label}',
        latest_sentiment.customer_label
      ) AS customer_sentiment_label,
      COALESCE(
        c.resolution_data #>> '{sentiment,customer,rationale}',
        latest_sentiment.customer_rationale
      ) AS customer_sentiment_rationale,
      c.resolution_data #>> '{sentiment,summary}' AS sentiment_summary,
      (
        c.assigned_agent_id IS NOT NULL
        OR c.assigned_at IS NOT NULL
        OR EXISTS (
          SELECT 1
          FROM ccass.conversation_assignments ca
          WHERE ca.conversation_id = c.id
            AND ca.organization_id = c.organization_id
            AND ca.state IN ('accepted', 'ended')
        )
      ) AS agent_connected
    FROM ccass.conversations c
    LEFT JOIN cdp.interactions i
      ON i.organization_id = c.organization_id
      AND i.conversation_id = c.id
    LEFT JOIN ccass.conversation_memory mem
      ON mem.organization_id = c.organization_id
      AND mem.conversation_id = c.id
    LEFT JOIN LATERAL (
      SELECT
        sentiment.customer_label,
        sentiment.rationale->>'customer' AS customer_rationale
      FROM ccass.conversation_sentiment_turns sentiment
      WHERE sentiment.organization_id = c.organization_id
        AND sentiment.conversation_id = c.id
      ORDER BY sentiment.created_at DESC
      LIMIT 1
    ) latest_sentiment ON TRUE
    LEFT JOIN LATERAL (
      SELECT m.id
      FROM ccass.conversation_messages m
      WHERE m.conversation_id = c.id
        AND m.organization_id = c.organization_id
      ORDER BY m.created_at DESC
      LIMIT 1
    ) anchor ON TRUE
    WHERE c.organization_id = ${organizationId}::bigint
      AND (
        (${hasContactIds} AND c.contact_id = ANY(${contactMatch.contactIds}::text[]))
        OR EXISTS (
          SELECT 1
          FROM cdp.identity_keys ik
          WHERE ik.organization_id = c.organization_id
            AND ik.cdp_id = ANY(${contactMatch.contactIds}::text[])
            AND (
                (
                  ik.key_type IN (
                    ${IDENTITY_KEY_TYPES.EMAIL},
                    ${IDENTITY_KEY_TYPES.EMAIL_SECONDARY}
                  )
                  AND lower(c.visitor_id) = lower(ik.key_value)
                )
                OR (
                  ik.key_type = ${IDENTITY_KEY_TYPES.WEBCHAT_VISITOR}
                  AND c.visitor_id = ik.key_value
                )
                OR (
                  ik.key_type IN (
                    ${IDENTITY_KEY_TYPES.WHATSAPP_PHONE},
                    ${IDENTITY_KEY_TYPES.PHONE},
                    ${IDENTITY_KEY_TYPES.PHONE_SECONDARY}
                  )
                  AND regexp_replace(COALESCE(c.visitor_id, ''), '\D', '', 'g') = ik.key_value
                )
                OR (
                  ik.key_type IN (
                    ${IDENTITY_KEY_TYPES.INSTAGRAM_USER},
                    ${IDENTITY_KEY_TYPES.FACEBOOK_USER}
                  )
                  AND c.visitor_id = ik.key_value
                )
              )
        )
      )
      AND (
        ${handledByUserId}::bigint IS NULL
        OR c.assigned_user_id = ${handledByUserId}::bigint
        OR EXISTS (
          SELECT 1
          FROM ccass.conversation_assignments ca
          INNER JOIN ccass.agents a
            ON a.id = ca.agent_id
           AND a.organization_id = ca.organization_id
          WHERE ca.conversation_id = c.id
            AND ca.organization_id = c.organization_id
            AND a.setup_user_id = ${handledByUserId}::bigint
            AND ca.state IN ('accepted', 'ended')
        )
      )
    ORDER BY c.updated_at DESC
    OFFSET ${offset} LIMIT ${limit}
  `;

  return {
    interactions: rows.map((row) => ({
      id: `${serializeEntityIdOptional(row.conversation_id)}:${serializeEntityIdOptional(row.message_id) ?? "summary"}`,
      conversationId: serializeEntityIdOptional(row.conversation_id)!,
      messageId: serializeEntityIdOptional(row.message_id),
      channel: row.channel,
      queueId: serializeEntityIdOptional(row.queue_id),
      subject: row.subject,
      status: row.status,
      summary: row.summary ?? "",
      occurredAt: row.occurred_at.toISOString(),
      createdAt: row.created_at.toISOString(),
      endedAt: row.ended_at?.toISOString() ?? null,
      resolvedAt: row.resolved_at?.toISOString() ?? null,
      endReason: row.end_reason ?? null,
      dispositionCode: row.disposition_code ?? null,
      resolutionCode: row.resolution_code ?? null,
      handoffReason: row.handoff_reason ?? null,
      agentConnected: Boolean(row.agent_connected),
      direction: row.direction === "outbound" ? "outbound" : "inbound",
      botMemory:
        row.rolling_summary || row.extracted_facts
          ? {
              rollingSummary: row.rolling_summary,
              extractedFacts: Array.isArray(row.extracted_facts)
                ? row.extracted_facts.filter((item): item is string => typeof item === "string")
                : [],
            }
          : null,
      sentiment: row.customer_sentiment_label
        ? {
            customerLabel: row.customer_sentiment_label,
            customerRationale: row.customer_sentiment_rationale,
            summary: row.sentiment_summary,
          }
        : null,
    })),
    total,
    offset,
    hasMore: offset + rows.length < total,
  };
}

export async function getContactCrossChannelSummary(
  db: DbClient,
  organizationId: string,
  contactId: string,
  limit = 5,
  handledByUserId?: string,
): Promise<Array<{ channel: string; conversationId: string; summary: string; occurredAt: string }>> {
  const page = await listContactInteractions(db, organizationId, contactId, {
    limit,
    offset: 0,
    handledByUserId,
  });
  return page.interactions.map((interaction) => ({
    channel: interaction.channel,
    conversationId: interaction.conversationId,
    summary: interaction.botMemory?.rollingSummary ?? interaction.summary,
    occurredAt: interaction.occurredAt,
  }));
}

/**
 * Allow contact-center users (including agents) to read a conversation that belongs
 * to a contact they can already view in the Contacts module.
 */
export async function assertContactConversationReadAccess(
  db: DbClient,
  organizationId: string,
  contactId: string,
  conversationId: string,
): Promise<void> {
  const contactMatch = await resolveContactConversationMatch(db, organizationId, contactId);
  const hasContactIds = contactMatch.contactIds.length > 0;

  const rows = await db.$queryRaw<{ allowed: boolean }[]>`
    SELECT EXISTS (
      SELECT 1
      FROM ccass.conversations c
      WHERE c.organization_id = ${organizationId}::bigint
        AND c.id = ${conversationId}::bigint
        AND (
          (${hasContactIds} AND c.contact_id = ANY(${contactMatch.contactIds}::text[]))
          OR EXISTS (
            SELECT 1
            FROM cdp.identity_keys ik
            WHERE ik.organization_id = c.organization_id
              AND ik.cdp_id = ANY(${contactMatch.contactIds}::text[])
              AND (
                (
                  ik.key_type IN (
                    ${IDENTITY_KEY_TYPES.EMAIL},
                    ${IDENTITY_KEY_TYPES.EMAIL_SECONDARY}
                  )
                  AND lower(c.visitor_id) = lower(ik.key_value)
                )
                OR (
                  ik.key_type = ${IDENTITY_KEY_TYPES.WEBCHAT_VISITOR}
                  AND c.visitor_id = ik.key_value
                )
                OR (
                  ik.key_type IN (
                    ${IDENTITY_KEY_TYPES.WHATSAPP_PHONE},
                    ${IDENTITY_KEY_TYPES.PHONE},
                    ${IDENTITY_KEY_TYPES.PHONE_SECONDARY}
                  )
                  AND regexp_replace(COALESCE(c.visitor_id, ''), '\D', '', 'g') = ik.key_value
                )
                OR (
                  ik.key_type IN (
                    ${IDENTITY_KEY_TYPES.INSTAGRAM_USER},
                    ${IDENTITY_KEY_TYPES.FACEBOOK_USER}
                  )
                  AND c.visitor_id = ik.key_value
                )
              )
          )
        )
    ) AS allowed
  `;

  if (!rows[0]?.allowed) {
    throw Object.assign(new Error("Conversation is not linked to this contact"), { status: 403 });
  }
}
