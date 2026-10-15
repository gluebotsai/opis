import type { DbClient } from "../lib/rls.js";
import { toCdpIdText } from "../lib/sql-uuid.js";
import { upsertIdentityKey, type IdentityKeyType } from "./cdp-customer-profile.js";
import { projectInteractionEvent } from "./cdp-projection.js";
import { scheduleOmniChannelSummaryRefresh } from "./omni-channel-summary.js";

export type MergeContactsInput = {
  winnerId: string;
  loserId: string;
  reason: string;
  triggerConversationId?: string;
};

export type MergeContactsResult = {
  winnerId: string;
  loserId: string;
  conversationsReassigned: number;
  interactionsReassigned: number;
  missedContactsReassigned: number;
  tasksReassigned: number;
  proactiveAttemptsReassigned: number;
  identityKeysMoved: number;
  noOp: boolean;
};

type ProfileRow = {
  cdp_id: string;
  first_name: string | null;
  last_name: string | null;
  company: string | null;
  city: string | null;
  country: string | null;
  first_seen_at: Date | null;
  last_seen_at: Date | null;
  custom_fields: Record<string, unknown> | null;
};

function readMergedInto(customFields: Record<string, unknown> | null | undefined): string | null {
  const value = customFields?.mergedInto;
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

/**
 * Follow a merge chain to its active root. A bounded recursive query also
 * protects request paths from malformed legacy cycles.
 */
export async function resolveCanonicalContactId(
  db: DbClient,
  organizationId: string,
  contactId: string,
): Promise<string> {
  const normalizedId = toCdpIdText(contactId);
  if (!normalizedId) return contactId;

  const rows = await db.$queryRaw<Array<{ cdp_id: string; depth: number }>>`
    WITH RECURSIVE chain AS (
      SELECT
        cp.cdp_id,
        NULLIF(cp.custom_fields->>'mergedInto', '') AS merged_into,
        0 AS depth,
        ARRAY[cp.cdp_id]::text[] AS visited
      FROM cdp.customer_profile cp
      WHERE cp.organization_id = ${organizationId}::bigint
        AND cp.cdp_id = ${normalizedId}::text

      UNION ALL

      SELECT
        parent.cdp_id,
        NULLIF(parent.custom_fields->>'mergedInto', '') AS merged_into,
        chain.depth + 1,
        chain.visited || parent.cdp_id
      FROM chain
      INNER JOIN cdp.customer_profile parent
        ON parent.organization_id = ${organizationId}::bigint
       AND parent.cdp_id = chain.merged_into
      WHERE chain.depth < 20
        AND NOT parent.cdp_id = ANY(chain.visited)
    )
    SELECT cdp_id, depth
    FROM chain
    ORDER BY depth DESC
    LIMIT 1
  `;

  return toCdpIdText(rows[0]?.cdp_id) ?? normalizedId;
}

function isPhoneLikeName(value: string | null | undefined): boolean {
  if (!value?.trim()) return false;
  const digits = value.replace(/\D/g, "");
  return digits.length >= 7 && digits.length / value.trim().length > 0.5;
}

function isEmailLocalPartName(value: string | null | undefined): boolean {
  if (!value?.trim()) return false;
  const trimmed = value.trim();
  return (
    !trimmed.includes(" ") &&
    !trimmed.includes("@") &&
    /^[a-z0-9._+-]+$/i.test(trimmed) &&
    trimmed.length >= 3
  );
}

function pickBetterName(
  winner: ProfileRow,
  loser: ProfileRow,
): { firstName: string | null; lastName: string | null } {
  const winnerFirst = winner.first_name?.trim() || null;
  const loserFirst = loser.first_name?.trim() || null;
  const winnerLooksWeak =
    !winnerFirst ||
    isPhoneLikeName(winnerFirst) ||
    winnerFirst.includes("@") ||
    isEmailLocalPartName(winnerFirst);
  const loserLooksStrong =
    loserFirst != null &&
    !isPhoneLikeName(loserFirst) &&
    !loserFirst.includes("@") &&
    !isEmailLocalPartName(loserFirst);

  if (winnerLooksWeak && loserLooksStrong) {
    return {
      firstName: loserFirst,
      lastName: loser.last_name?.trim() || winner.last_name,
    };
  }
  return {
    firstName: winnerFirst,
    lastName: winner.last_name?.trim() || loser.last_name,
  };
}

export async function mergeContacts(
  db: DbClient,
  organizationId: string,
  input: MergeContactsInput,
): Promise<MergeContactsResult> {
  const requestedWinnerId = toCdpIdText(input.winnerId);
  const requestedLoserId = toCdpIdText(input.loserId);
  const { reason, triggerConversationId } = input;
  if (!requestedWinnerId || !requestedLoserId) {
    throw Object.assign(new Error("Contact profile not found for merge"), { status: 404 });
  }
  const winnerId = await resolveCanonicalContactId(db, organizationId, requestedWinnerId);
  const loserId = requestedLoserId;
  const loserCanonicalId = await resolveCanonicalContactId(db, organizationId, loserId);
  if (loserCanonicalId === winnerId) {
    return {
      winnerId,
      loserId,
      conversationsReassigned: 0,
      interactionsReassigned: 0,
      missedContactsReassigned: 0,
      tasksReassigned: 0,
      proactiveAttemptsReassigned: 0,
      identityKeysMoved: 0,
      noOp: true,
    };
  }
  if (loserCanonicalId !== loserId) {
    throw Object.assign(new Error("Loser contact was already merged into another profile"), {
      status: 409,
    });
  }
  if (winnerId === loserId) {
    return {
      winnerId,
      loserId,
      conversationsReassigned: 0,
      interactionsReassigned: 0,
      missedContactsReassigned: 0,
      tasksReassigned: 0,
      proactiveAttemptsReassigned: 0,
      identityKeysMoved: 0,
      noOp: true,
    };
  }

  const lockKey = [organizationId, winnerId, loserId].sort().join(":");
  await db.$executeRaw`
    SELECT pg_advisory_xact_lock(hashtextextended(${lockKey}, 0))
  `;

  const [firstProfileId, secondProfileId] = [winnerId, loserId].sort();
  await db.$executeRaw`
    SELECT cdp_id
    FROM cdp.customer_profile
    WHERE organization_id = ${organizationId}::bigint
      AND cdp_id IN (${firstProfileId}::text, ${secondProfileId}::text)
    ORDER BY cdp_id
    FOR UPDATE
  `;

  const profileRows = await db.$queryRaw<ProfileRow[]>`
    SELECT cdp_id, first_name, last_name, company, city, country,
           first_seen_at, last_seen_at, custom_fields
    FROM cdp.customer_profile
    WHERE organization_id = ${organizationId}::bigint
      AND cdp_id IN (${winnerId}::text, ${loserId}::text)
  `;
  const winner = profileRows.find((row) => toCdpIdText(row.cdp_id) === winnerId);
  const loser = profileRows.find((row) => toCdpIdText(row.cdp_id) === loserId);
  if (!winner || !loser) {
    throw Object.assign(new Error("Contact profile not found for merge"), { status: 404 });
  }

  const loserMergedInto = readMergedInto(loser.custom_fields);
  if (loserMergedInto === winnerId) {
    return {
      winnerId,
      loserId,
      conversationsReassigned: 0,
      interactionsReassigned: 0,
      missedContactsReassigned: 0,
      tasksReassigned: 0,
      proactiveAttemptsReassigned: 0,
      identityKeysMoved: 0,
      noOp: true,
    };
  }
  if (loserMergedInto && loserMergedInto !== winnerId) {
    throw Object.assign(new Error("Loser contact was already merged into another profile"), {
      status: 409,
    });
  }

  const lineageRows = await db.$queryRaw<Array<{ cdp_id: string }>>`
    WITH RECURSIVE lineage AS (
      SELECT cp.cdp_id
      FROM cdp.customer_profile cp
      WHERE cp.organization_id = ${organizationId}::bigint
        AND cp.cdp_id = ${loserId}::text

      UNION

      SELECT child.cdp_id
      FROM cdp.customer_profile child
      INNER JOIN lineage parent
        ON NULLIF(child.custom_fields->>'mergedInto', '') = parent.cdp_id
      WHERE child.organization_id = ${organizationId}::bigint
    )
    SELECT cdp_id FROM lineage
  `;
  const lineageIds = lineageRows.map((row) => row.cdp_id);
  const lineageContactIds = lineageIds;

  const identityKeyRows = await db.$queryRaw<
    Array<{
      cdp_id: string;
      key_type: IdentityKeyType;
      key_value: string;
      source_system: string | null;
    }>
  >`
    SELECT cdp_id, key_type, key_value, source_system
    FROM cdp.identity_keys
    WHERE organization_id = ${organizationId}::bigint
      AND cdp_id = ANY(${lineageIds}::text[])
  `;

  for (const key of identityKeyRows) {
    await upsertIdentityKey(
      db,
      organizationId,
      winnerId,
      key.key_type,
      key.key_value,
      key.source_system,
      { allowReassign: true },
    );
  }

  const conversationUpdate = lineageContactIds.length === 0 ? 0 : await db.$executeRaw`
    UPDATE ccass.conversations
    SET contact_id = ${winnerId}, updated_at = NOW()
    WHERE organization_id = ${organizationId}::bigint
      AND contact_id = ANY(${lineageContactIds}::text[])
  `;

  const interactionUpdate = lineageContactIds.length === 0 ? 0 : await db.$executeRaw`
    UPDATE cdp.interactions
    SET contact_id = ${winnerId}, updated_at = NOW()
    WHERE organization_id = ${organizationId}::bigint
      AND contact_id = ANY(${lineageContactIds}::text[])
  `;

  const missedContactUpdate = lineageContactIds.length === 0 ? 0 : await db.$executeRaw`
    UPDATE ccass.agent_missed_contacts
    SET contact_id = ${winnerId}
    WHERE organization_id = ${organizationId}::bigint
      AND contact_id = ANY(${lineageContactIds}::text[])
  `;

  const taskUpdate = lineageContactIds.length === 0 ? 0 : await db.$executeRaw`
    UPDATE ccass.agent_tasks
    SET contact_id = ${winnerId}, updated_at = NOW()
    WHERE organization_id = ${organizationId}::bigint
      AND contact_id = ANY(${lineageContactIds}::text[])
  `;

  const proactiveAttemptUpdate = lineageContactIds.length === 0 ? 0 : await db.$executeRaw`
    UPDATE ccass.proactive_callback_attempts
    SET contact_id = ${winnerId}, updated_at = NOW()
    WHERE organization_id = ${organizationId}::bigint
      AND contact_id = ANY(${lineageContactIds}::text[])
  `;

  const names = pickBetterName(winner, loser);
  const mergedCustomFields = {
    ...(typeof winner.custom_fields === "object" && winner.custom_fields ? winner.custom_fields : {}),
    isActive: true,
  };

  await db.$executeRaw`
    UPDATE cdp.customer_profile
    SET
      first_name = COALESCE(${names.firstName}, first_name),
      last_name = COALESCE(${names.lastName}, last_name),
      company = COALESCE(NULLIF(${loser.company ?? ""}, ''), company),
      city = COALESCE(NULLIF(${loser.city ?? ""}, ''), city),
      country = COALESCE(NULLIF(${loser.country ?? ""}, ''), country),
      first_seen_at = LEAST(first_seen_at, ${loser.first_seen_at ?? winner.first_seen_at}),
      last_seen_at = GREATEST(last_seen_at, ${loser.last_seen_at ?? winner.last_seen_at}),
      custom_fields = ${JSON.stringify(mergedCustomFields)}::jsonb,
      updated_at = NOW()
    WHERE organization_id = ${organizationId}::bigint
      AND cdp_id = ${winnerId}::text
  `;

  await db.$executeRaw`
    UPDATE cdp.customer_profile
    SET custom_fields =
          COALESCE(custom_fields, '{}'::jsonb)
          || jsonb_build_object(
            'isActive', false,
            'mergedInto', ${winnerId}::text,
            'mergedAt', ${new Date().toISOString()}::text,
            'mergeReason', ${reason}::text
          ),
      updated_at = NOW()
    WHERE organization_id = ${organizationId}::bigint
      AND cdp_id = ANY(${lineageIds}::text[])
      AND cdp_id <> ${winnerId}::text
  `;

  if (triggerConversationId) {
    await projectInteractionEvent(db, organizationId, {
      conversationId: triggerConversationId,
      eventType: "contact.merged",
      metadata: { winnerId, loserId, reason },
    });
  }

  scheduleOmniChannelSummaryRefresh(organizationId, winnerId);

  return {
    winnerId,
    loserId,
    conversationsReassigned: Number(conversationUpdate),
    interactionsReassigned: Number(interactionUpdate),
    missedContactsReassigned: Number(missedContactUpdate),
    tasksReassigned: Number(taskUpdate),
    proactiveAttemptsReassigned: Number(proactiveAttemptUpdate),
    identityKeysMoved: identityKeyRows.length,
    noOp: false,
  };
}
