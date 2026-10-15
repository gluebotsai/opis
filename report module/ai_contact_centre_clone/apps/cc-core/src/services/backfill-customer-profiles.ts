import { randomUUID } from "node:crypto";

import type { DbClient } from "../lib/rls.js";
import {
  IDENTITY_KEY_TYPES,
  findCdpIdByIdentityKey,
  upsertIdentityKey,
  type IdentityKeyType,
} from "./cdp-customer-profile.js";
import { normalizeEmail, normalizePhone } from "./contact-identity.js";

type ConversationRow = {
  id: string;
  organization_id: string;
  channel: string;
  visitor_id: string | null;
  contact_id: string | null;
};

type DerivedIdentity = {
  keyType: IdentityKeyType;
  keyValue: string;
  sourceChannel: string;
};

export type BackfillCustomerProfilesResult = {
  profilesCreated: number;
  profilesUpdated: number;
  identityKeysUpserted: number;
  conversationsLinked: number;
  groupsProcessed: number;
};

function deriveIdentities(channel: string, visitorId: string | null): DerivedIdentity[] {
  if (!visitorId?.trim()) return [];
  const trimmed = visitorId.trim();
  const identities: DerivedIdentity[] = [];

  if (channel === "email" || trimmed.includes("@")) {
    const email = normalizeEmail(trimmed);
    if (email) {
      identities.push({
        keyType: IDENTITY_KEY_TYPES.EMAIL,
        keyValue: email,
        sourceChannel: channel === "whatsapp" ? "whatsapp" : channel === "webchat" ? "webchat" : "email",
      });
    }
  }

  if (channel === "whatsapp" || /^\+?\d{7,}$/.test(trimmed.replace(/\D/g, ""))) {
    const digits = normalizePhone(trimmed);
    if (digits && channel === "whatsapp") {
      identities.push({
        keyType: IDENTITY_KEY_TYPES.PHONE,
        keyValue: trimmed.startsWith("+") ? trimmed : digits,
        sourceChannel: "whatsapp",
      });
      identities.push({
        keyType: IDENTITY_KEY_TYPES.WHATSAPP_PHONE,
        keyValue: digits,
        sourceChannel: "whatsapp",
      });
    }
  }

  if (channel === "webchat" || trimmed.startsWith("v_") || trimmed.startsWith("visitor_")) {
    identities.push({
      keyType: IDENTITY_KEY_TYPES.WEBCHAT_VISITOR,
      keyValue: trimmed,
      sourceChannel: "webchat",
    });
  }

  return identities;
}

function displayNameFromIdentities(identities: DerivedIdentity[]): { firstName: string | null; lastName: string | null } {
  const email = identities.find((entry) => entry.keyType === IDENTITY_KEY_TYPES.EMAIL)?.keyValue;
  if (email) {
    const local = email.split("@")[0] ?? email;
    const parts = local.replace(/[._+-]/g, " ").trim().split(/\s+/).filter(Boolean);
    return {
      firstName: parts[0] ?? local,
      lastName: parts.length > 1 ? parts.slice(1).join(" ") : null,
    };
  }

  const phone = identities.find(
    (entry) =>
      entry.keyType === IDENTITY_KEY_TYPES.PHONE ||
      entry.keyType === IDENTITY_KEY_TYPES.WHATSAPP_PHONE,
  )?.keyValue;
  if (phone && !email) {
    return { firstName: null, lastName: null };
  }

  const visitor = identities.find(
    (entry) => entry.keyType === IDENTITY_KEY_TYPES.WEBCHAT_VISITOR,
  )?.keyValue;
  if (visitor) {
    const short = visitor.replace(/^v_/, "").slice(0, 12);
    return { firstName: "Visitor", lastName: short };
  }

  return { firstName: "Unknown", lastName: null };
}

function acquisitionChannel(channels: Set<string>): string | null {
  if (channels.size === 0) return null;
  if (channels.size === 1) return [...channels][0] ?? null;
  return "omnichannel";
}

async function profileExists(
  db: DbClient,
  organizationId: string,
  cdpId: string,
): Promise<boolean> {
  const rows = await db.$queryRaw<Array<{ exists: boolean }>>`
    SELECT EXISTS (
      SELECT 1
      FROM cdp.customer_profile
      WHERE organization_id = ${organizationId}::bigint
        AND cdp_id = ${cdpId}::text
    ) AS exists
  `;
  return rows[0]?.exists ?? false;
}

export async function backfillCustomerProfilesFromConversations(
  db: DbClient,
  options: { organizationId?: string; dryRun?: boolean } = {},
): Promise<BackfillCustomerProfilesResult> {
  const { organizationId, dryRun = false } = options;

  const conversations = await db.$queryRaw<ConversationRow[]>`
    SELECT id, organization_id, channel, visitor_id, contact_id
    FROM ccass.conversations
    WHERE (${organizationId ?? null}::bigint IS NULL OR organization_id = ${organizationId ?? null}::bigint)
    ORDER BY organization_id, updated_at ASC
  `;

  const groups = new Map<
    string,
    {
      organizationId: string;
      cdpId: string;
      channels: Set<string>;
      identities: Map<string, DerivedIdentity>;
      conversationIds: string[];
    }
  >();

  const pendingIdentityOwners = new Map<string, string>();

  function identityMapKey(organizationId: string, identity: DerivedIdentity): string {
    return `${organizationId}:${identity.keyType}:${identity.keyValue.toLowerCase()}`;
  }

  async function resolveCdpIdForRow(
    row: ConversationRow,
    identities: DerivedIdentity[],
  ): Promise<string> {
    if (row.contact_id) return row.contact_id;

    for (const identity of identities) {
      const pending = pendingIdentityOwners.get(identityMapKey(row.organization_id, identity));
      if (pending) return pending;

      const existing = await findCdpIdByIdentityKey(
        db,
        row.organization_id,
        identity.keyType,
        identity.keyValue,
      );
      if (existing) return existing;
    }

    const cdpId = randomUUID();
    for (const identity of identities) {
      pendingIdentityOwners.set(identityMapKey(row.organization_id, identity), cdpId);
    }
    return cdpId;
  }

  for (const row of conversations) {
    const identities = deriveIdentities(row.channel, row.visitor_id);
    const cdpId = await resolveCdpIdForRow(row, identities);
    const groupKey = `${row.organization_id}:${cdpId}`;
    const existing = groups.get(groupKey) ?? {
      organizationId: row.organization_id,
      cdpId,
      channels: new Set<string>(),
      identities: new Map<string, DerivedIdentity>(),
      conversationIds: [],
    };

    existing.channels.add(row.channel);
    for (const identity of identities) {
      existing.identities.set(`${identity.keyType}:${identity.keyValue}`, identity);
    }
    existing.conversationIds.push(row.id);
    groups.set(groupKey, existing);
  }

  let profilesCreated = 0;
  let profilesUpdated = 0;
  let identityKeysUpserted = 0;
  let conversationsLinked = 0;

  for (const group of groups.values()) {
    const identityList = [...group.identities.values()];
    const { firstName, lastName } = displayNameFromIdentities(identityList);
    const exists = await profileExists(db, group.organizationId, group.cdpId);

    if (dryRun) {
      if (!exists) profilesCreated += 1;
      else profilesUpdated += 1;
      identityKeysUpserted += identityList.length;
      conversationsLinked += group.conversationIds.length;
      continue;
    }

    if (!exists) {
      await db.$executeRaw`
        INSERT INTO cdp.customer_profile (
          cdp_id, organization_id, first_name, last_name,
          acquisition_channel, custom_fields, first_seen_at, last_seen_at,
          created_at, updated_at
        ) VALUES (
          ${group.cdpId}::bigint,
          ${group.organizationId}::bigint,
          ${firstName},
          ${lastName},
          ${acquisitionChannel(group.channels)},
          ${JSON.stringify({ isActive: true, backfilledFrom: "ccass.conversations" })}::jsonb,
          NOW(),
          NOW(),
          NOW(),
          NOW()
        )
      `;
      profilesCreated += 1;
    } else {
      await db.$executeRaw`
        UPDATE cdp.customer_profile
        SET
          first_name = COALESCE(NULLIF(first_name, ''), ${firstName}),
          last_name = COALESCE(last_name, ${lastName}),
          acquisition_channel = COALESCE(acquisition_channel, ${acquisitionChannel(group.channels)}),
          last_seen_at = NOW(),
          updated_at = NOW()
        WHERE organization_id = ${group.organizationId}::bigint
          AND cdp_id = ${group.cdpId}::text
      `;
      profilesUpdated += 1;
    }

    for (const identity of identityList) {
      await upsertIdentityKey(
        db,
        group.organizationId,
        group.cdpId,
        identity.keyType,
        identity.keyValue,
        identity.sourceChannel,
      );
      identityKeysUpserted += 1;
    }

    for (const conversationId of group.conversationIds) {
      await db.$executeRaw`
        UPDATE ccass.conversations
        SET contact_id = ${group.cdpId}, updated_at = NOW()
        WHERE id = ${conversationId}::bigint
          AND organization_id = ${group.organizationId}::bigint
          AND (contact_id IS NULL OR contact_id <> ${group.cdpId})
      `;
      conversationsLinked += 1;
    }
  }

  return {
    profilesCreated,
    profilesUpdated,
    identityKeysUpserted,
    conversationsLinked,
    groupsProcessed: groups.size,
  };
}
