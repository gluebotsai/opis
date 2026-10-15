import type { PrismaClient } from "@ai-contact-center/db-cc";

import { isEntityId } from "../lib/id-schema.js";
import type { DbClient } from "../lib/rls.js";
import { withOrganizationContext } from "../lib/rls.js";

const PHONE_MATCHED_AS = new Set(["phone", "phone_secondary", "whatsapp_phone"]);

export type LiveConversationParty = "bot" | "queue" | "agent";

export type LiveConversationRecord = {
  conversationId: string;
  channel: string;
  status: string;
  with: LiveConversationParty;
  assignedUserId: string | null;
  startedAt: string;
  updatedAt: string;
};

export type LiveConversationsResult = {
  contactId: string | null;
  matchedAs: string | null;
  live: boolean;
  channels: string[];
  conversations: LiveConversationRecord[];
};

const EMPTY_RESULT: LiveConversationsResult = {
  contactId: null,
  matchedAs: null,
  live: false,
  channels: [],
  conversations: [],
};

export function liveConversationParty(status: string): LiveConversationParty {
  if (status === "bot_active") return "bot";
  if (status === "queued") return "queue";
  return "agent";
}

/** Phone-suffix match on voice and WhatsApp visitor ids. Skip it once a non-phone identity won. */
export function shouldMatchVisitorByPhone(identifier: string, matchedAs: string | null): boolean {
  if (matchedAs && !PHONE_MATCHED_AS.has(matchedAs)) return false;
  const digits = identifier.replace(/\D/g, "");
  return digits.length >= 10;
}

export function matchedAsFromChannel(channel: string): string | null {
  switch (channel) {
    case "webchat":
      return "webchat_visitor";
    case "whatsapp":
      return "whatsapp_phone";
    case "instagram":
      return "instagram_user";
    case "facebook":
      return "facebook_user";
    case "voice":
      return "phone";
    case "email":
      return "email";
    default:
      return null;
  }
}

export function buildLiveConversationsResult(input: {
  contactId: string | null;
  matchedAs: string | null;
  conversations: LiveConversationRecord[];
}): LiveConversationsResult {
  const channels: string[] = [];
  for (const conversation of input.conversations) {
    if (!channels.includes(conversation.channel)) channels.push(conversation.channel);
  }
  const matchedAs =
    input.matchedAs ??
    (input.conversations[0] ? matchedAsFromChannel(input.conversations[0].channel) : null);
  return {
    contactId: input.contactId,
    matchedAs,
    live: input.conversations.length > 0,
    channels,
    conversations: input.conversations,
  };
}

type IdentityHit = {
  cdp_id: string;
  matched_as: string;
};

type OpenConversationRow = {
  conversation_id: string;
  channel: string;
  status: string;
  assigned_user_id: string | null;
  created_at: Date;
  updated_at: Date;
};

async function findIdentity(
  db: DbClient,
  organizationId: string,
  identifier: string,
): Promise<IdentityHit | null> {
  const rows = await db.$queryRaw<IdentityHit[]>`
    WITH ranked AS (
      SELECT
        cp.cdp_id,
        CASE
          WHEN cp.cdp_id = ${identifier} THEN 'cdp_id'
          ELSE ik.key_type
        END AS matched_as,
        CASE
          WHEN cp.cdp_id = ${identifier} THEN 0
          WHEN btrim(ik.key_value) = ${identifier} THEN 1
          WHEN lower(btrim(ik.key_value)) = lower(${identifier}) THEN 2
          ELSE 3
        END AS match_rank,
        cp.updated_at
      FROM cdp.customer_profile cp
      LEFT JOIN cdp.identity_keys ik
        ON ik.organization_id = cp.organization_id
       AND ik.cdp_id = cp.cdp_id
      WHERE cp.organization_id = ${organizationId}::bigint
        AND (
          cp.cdp_id = ${identifier}
          OR btrim(ik.key_value) = ${identifier}
          OR lower(btrim(ik.key_value)) = lower(${identifier})
          OR (
            ik.key_type IN ('phone', 'phone_secondary', 'whatsapp_phone')
            AND cdp.identity_phone_matches(${identifier}, ik.key_value)
          )
        )
    )
    SELECT cdp_id, matched_as
    FROM ranked
    ORDER BY match_rank ASC, updated_at DESC NULLS LAST
    LIMIT 1
  `;
  return rows[0] ?? null;
}

async function peerContactIds(
  db: DbClient,
  organizationId: string,
  contactId: string,
): Promise<string[]> {
  const rows = await db.$queryRaw<{ cdp_id: string }[]>`
    SELECT DISTINCT ik_peer.cdp_id
    FROM cdp.identity_keys ik_self
    INNER JOIN cdp.identity_keys ik_peer
      ON ik_peer.organization_id = ik_self.organization_id
     AND ik_peer.key_type = ik_self.key_type
     AND ik_peer.key_value = ik_self.key_value
    WHERE ik_self.organization_id = ${organizationId}::bigint
      AND ik_self.cdp_id = ${contactId}
  `;
  return [...new Set([contactId, ...rows.map((row) => row.cdp_id)])];
}

async function findOpenConversations(
  db: DbClient,
  organizationId: string,
  identifier: string,
  contactIds: string[],
  phoneMatchVisitor: boolean,
): Promise<OpenConversationRow[]> {
  const hasContacts = contactIds.length > 0;
  const ids = hasContacts ? contactIds : [""];
  return db.$queryRaw<OpenConversationRow[]>`
    SELECT
      c.id::text AS conversation_id,
      c.channel,
      c.status,
      c.assigned_user_id::text AS assigned_user_id,
      c.created_at,
      c.updated_at
    FROM ccass.conversations c
    WHERE c.organization_id = ${organizationId}::bigint
      AND c.status NOT IN ('resolved', 'closed')
      AND (
        (${hasContacts} AND c.contact_id = ANY(${ids}::text[]))
        OR btrim(c.visitor_id) = ${identifier}
        OR lower(btrim(c.visitor_id)) = lower(${identifier})
        OR (
          ${phoneMatchVisitor}::boolean
          AND c.channel IN ('voice', 'whatsapp')
          AND c.visitor_id IS NOT NULL
          AND cdp.identity_phone_matches(${identifier}, c.visitor_id)
        )
      )
    ORDER BY c.updated_at DESC
  `;
}

export async function listLiveConversations(
  prisma: PrismaClient,
  input: { organizationId: string; identifier: string },
): Promise<LiveConversationsResult> {
  const organizationId = input.organizationId.trim();
  const identifier = input.identifier.trim();
  if (!isEntityId(organizationId)) {
    throw Object.assign(new Error("organizationId must be a numeric organization id"), { status: 400 });
  }
  if (!identifier) {
    throw Object.assign(new Error("identifier is required"), { status: 400 });
  }

  return withOrganizationContext(prisma, organizationId, async (db) => {
    const identity = await findIdentity(db, organizationId, identifier);
    const contactIds = identity ? await peerContactIds(db, organizationId, identity.cdp_id) : [];
    const rows = await findOpenConversations(
      db,
      organizationId,
      identifier,
      contactIds,
      shouldMatchVisitorByPhone(identifier, identity?.matched_as ?? null),
    );
    if (!identity && rows.length === 0) return EMPTY_RESULT;

    return buildLiveConversationsResult({
      contactId: identity?.cdp_id ?? null,
      matchedAs: identity?.matched_as ?? null,
      conversations: rows.map((row) => ({
        conversationId: row.conversation_id,
        channel: row.channel,
        status: row.status,
        with: liveConversationParty(row.status),
        assignedUserId: row.assigned_user_id,
        startedAt: row.created_at.toISOString(),
        updatedAt: row.updated_at.toISOString(),
      })),
    });
  });
}
