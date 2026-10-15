/**
 * Keep a single contact (by phone) and remove all other contacts plus their
 * conversations and CDP interactions for the org.
 *
 * Usage:
 *   npx tsx apps/cc-core/scripts/cleanup-contacts-keep-single.ts
 *   npx tsx apps/cc-core/scripts/cleanup-contacts-keep-single.ts --live
 *   npx tsx apps/cc-core/scripts/cleanup-contacts-keep-single.ts --org-id <uuid> --phone 919150911820 --live
 */
import "@ai-contact-center/config/load-root-env";
import { ccPrisma } from "@ai-contact-center/db-cc";

import { IDENTITY_KEY_TYPES } from "../src/services/cdp-customer-profile.js";
import { mergeContacts } from "../src/services/contact-merge.js";

const ORG_ID = process.env.ORGANIZATION_ID ?? "ce4ff326-4c0e-43f2-a978-e6b494cd0775";
const KEEP_PHONE = (process.env.KEEP_PHONE ?? "919150911820").replace(/\D/g, "");
const live = process.argv.includes("--live");

function readArg(name: string): string | undefined {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

const organizationId = readArg("org-id") ?? ORG_ID;
const keepPhone = (readArg("phone") ?? KEEP_PHONE).replace(/\D/g, "");

function serialize(value: unknown): string {
  return JSON.stringify(
    value,
    (_key, current) => (typeof current === "bigint" ? Number(current) : current),
    2,
  );
}

type ContactPreview = {
  cdp_id: string;
  first_name: string | null;
  last_name: string | null;
  email: string | null;
  phone: string | null;
  is_active: boolean;
};

async function setSessionContext(db: typeof ccPrisma) {
  await db.$executeRaw`SELECT set_config('app.is_staff', 'true', true)`;
  await db.$executeRaw`SELECT set_config('app.organization_id', ${organizationId}, true)`;
  await db.$executeRaw`SELECT set_config('app.current_org_id', ${organizationId}, true)`;
}

async function resolveWinnerId(db: typeof ccPrisma): Promise<string | null> {
  const phoneTypes = [
    IDENTITY_KEY_TYPES.PHONE,
    IDENTITY_KEY_TYPES.PHONE_SECONDARY,
    IDENTITY_KEY_TYPES.WHATSAPP_PHONE,
  ];

  for (const keyType of phoneTypes) {
    const rows = await db.$queryRaw<Array<{ cdp_id: string }>>`
      SELECT cdp_id
      FROM cdp.identity_keys
      WHERE organization_id = ${organizationId}::bigint
        AND key_type = ${keyType}
        AND regexp_replace(key_value, '[^0-9]', '', 'g') = ${keepPhone}
      LIMIT 1
    `;
    if (rows[0]?.cdp_id) return rows[0].cdp_id;
  }

  const profileRows = await db.$queryRaw<Array<{ cdp_id: string }>>`
    SELECT cdp_id
    FROM cdp.customer_profile
    WHERE organization_id = ${organizationId}::bigint
      AND regexp_replace(COALESCE(first_name, ''), '[^0-9]', '', 'g') = ${keepPhone}
    LIMIT 1
  `;
  return profileRows[0]?.cdp_id ?? null;
}

async function listContacts(db: typeof ccPrisma): Promise<ContactPreview[]> {
  return db.$queryRaw<ContactPreview[]>`
    SELECT
      cp.cdp_id,
      cp.first_name,
      cp.last_name,
      email_ik.key_value AS email,
      phone_ik.key_value AS phone,
      COALESCE((cp.custom_fields->>'isActive')::boolean, TRUE) AS is_active
    FROM cdp.customer_profile cp
    LEFT JOIN LATERAL (
      SELECT key_value
      FROM cdp.identity_keys
      WHERE cdp_id = cp.cdp_id
        AND organization_id = cp.organization_id
        AND key_type IN (${IDENTITY_KEY_TYPES.EMAIL}, ${IDENTITY_KEY_TYPES.EMAIL_SECONDARY})
      LIMIT 1
    ) email_ik ON TRUE
    LEFT JOIN LATERAL (
      SELECT key_value
      FROM cdp.identity_keys
      WHERE cdp_id = cp.cdp_id
        AND organization_id = cp.organization_id
        AND key_type IN (
          ${IDENTITY_KEY_TYPES.PHONE},
          ${IDENTITY_KEY_TYPES.PHONE_SECONDARY},
          ${IDENTITY_KEY_TYPES.WHATSAPP_PHONE}
        )
      LIMIT 1
    ) phone_ik ON TRUE
    WHERE cp.organization_id = ${organizationId}::bigint
    ORDER BY cp.updated_at DESC
  `;
}

async function deleteConversationsForContacts(db: typeof ccPrisma, contactIds: string[]) {
  if (contactIds.length === 0) return { conversations: 0, interactions: 0, events: 0 };

  const conversationRows = await db.$queryRaw<Array<{ id: string }>>`
    SELECT id
    FROM ccass.conversations
    WHERE organization_id = ${organizationId}::bigint
      AND contact_id = ANY(${contactIds}::bigint[])
  `;
  const conversationIds = conversationRows.map((row) => row.id);
  if (conversationIds.length === 0) {
    return { conversations: 0, interactions: 0, events: 0 };
  }

  const deletedEvents = await db.$executeRaw`
    DELETE FROM cdp.interaction_events
    WHERE organization_id = ${organizationId}::bigint
      AND conversation_id = ANY(${conversationIds}::bigint[])
  `;
  const deletedInteractions = await db.$executeRaw`
    DELETE FROM cdp.interactions
    WHERE organization_id = ${organizationId}::bigint
      AND conversation_id = ANY(${conversationIds}::bigint[])
  `;
  await db.$executeRaw`
    DELETE FROM ccass.routing_attempts
    WHERE organization_id = ${organizationId}::bigint
      AND conversation_id = ANY(${conversationIds}::bigint[])
  `;
  const deletedConversations = await db.$executeRaw`
    DELETE FROM ccass.conversations
    WHERE organization_id = ${organizationId}::bigint
      AND id = ANY(${conversationIds}::bigint[])
  `;

  return {
    conversations: Number(deletedConversations),
    interactions: Number(deletedInteractions),
    events: Number(deletedEvents),
  };
}

async function retireContacts(db: typeof ccPrisma, contactIds: string[]) {
  if (contactIds.length === 0) return { profiles: 0, identityKeys: 0, orphanInteractions: 0 };

  const deletedKeys = await db.$executeRaw`
    DELETE FROM cdp.identity_keys
    WHERE organization_id = ${organizationId}::bigint
      AND cdp_id = ANY(${contactIds}::text[])
  `;

  const orphanInteractions = await db.$executeRaw`
    DELETE FROM cdp.interactions
    WHERE organization_id = ${organizationId}::bigint
      AND contact_id = ANY(${contactIds}::bigint[])
  `;

  const retiredProfiles = await db.$executeRaw`
    UPDATE cdp.customer_profile
    SET
      custom_fields = COALESCE(custom_fields, '{}'::jsonb)
        || jsonb_build_object(
          'isActive', false,
          'retiredAt', to_jsonb(NOW()::text),
          'retiredReason', 'cleanup_contacts_keep_single'
        ),
      updated_at = NOW()
    WHERE organization_id = ${organizationId}::bigint
      AND cdp_id = ANY(${contactIds}::text[])
  `;

  return {
    profiles: Number(retiredProfiles),
    identityKeys: Number(deletedKeys),
    orphanInteractions: Number(orphanInteractions),
  };
}

async function ensureWinnerProfile(db: typeof ccPrisma, winnerId: string) {
  await db.$executeRaw`
    UPDATE cdp.customer_profile
    SET
      first_name = COALESCE(NULLIF(first_name, ''), 'Bharathi'),
      custom_fields = COALESCE(custom_fields, '{}'::jsonb) || jsonb_build_object('isActive', true),
      updated_at = NOW()
    WHERE organization_id = ${organizationId}::bigint
      AND cdp_id = ${winnerId}::text
  `;

  await db.$executeRaw`
    INSERT INTO cdp.identity_keys (
      cdp_id, organization_id, key_type, key_value, source_system, verified, created_at
    ) VALUES (
      ${winnerId}::bigint,
      ${organizationId}::bigint,
      ${IDENTITY_KEY_TYPES.PHONE},
      ${keepPhone},
      'cleanup_contacts_keep_single',
      FALSE,
      NOW()
    )
    ON CONFLICT (organization_id, key_type, key_value) DO UPDATE SET
      cdp_id = EXCLUDED.cdp_id,
      source_system = EXCLUDED.source_system
  `;
}

async function main() {
  await setSessionContext(ccPrisma);

  const winnerId = await resolveWinnerId(ccPrisma);
  if (!winnerId) {
    throw new Error(`No contact found with phone ${keepPhone} in org ${organizationId}`);
  }

  const contactsBefore = await listContacts(ccPrisma);
  const activeOthers = contactsBefore.filter(
    (contact) => contact.cdp_id !== winnerId && contact.is_active,
  );
  const bharathiDuplicates = activeOthers.filter(
    (contact) => contact.first_name?.trim().toLowerCase() === "bharathi",
  );
  const otherContacts = activeOthers.filter(
    (contact) => contact.first_name?.trim().toLowerCase() !== "bharathi",
  );

  console.log(
    serialize({
      organizationId,
      keepPhone,
      live,
      winnerId,
      contactsBefore: contactsBefore.length,
      activeOthers: activeOthers.length,
      bharathiDuplicates: bharathiDuplicates.map((contact) => ({
        id: contact.cdp_id,
        email: contact.email,
        phone: contact.phone,
      })),
      otherContactsSample: otherContacts.slice(0, 8).map((contact) => ({
        id: contact.cdp_id,
        name: [contact.first_name, contact.last_name].filter(Boolean).join(" "),
        email: contact.email,
      })),
    }),
  );

  if (!live) {
    console.log("\nDry run only. Re-run with --live to apply.");
    return;
  }

  const mergeResults = [];
  await ccPrisma.$transaction(
    async (db) => {
      await setSessionContext(db);

      for (const duplicate of bharathiDuplicates) {
        mergeResults.push(
          await mergeContacts(db, organizationId, {
            winnerId,
            loserId: duplicate.cdp_id,
            reason: "cleanup_contacts_keep_single_merge_bharathi",
          }),
        );
      }

      const loserIds = activeOthers.map((contact) => contact.cdp_id);
      const conversationCleanup = await deleteConversationsForContacts(db, loserIds);
      const retireResult = await retireContacts(db, loserIds);
      await ensureWinnerProfile(db, winnerId);

      return { mergeResults, conversationCleanup, retireResult };
    },
    { timeout: 120_000 },
  ).then((result) => {
    console.log(
      serialize({
        status: "complete",
        ...result,
      }),
    );
  });

  await setSessionContext(ccPrisma);
  const contactsAfter = await listContacts(ccPrisma);
  const activeAfter = contactsAfter.filter((contact) => contact.is_active);
  console.log(
    serialize({
      activeContactsAfter: activeAfter.map((contact) => ({
        id: contact.cdp_id,
        name: [contact.first_name, contact.last_name].filter(Boolean).join(" "),
        email: contact.email,
        phone: contact.phone,
      })),
    }),
  );
}

main()
  .catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await ccPrisma.$disconnect();
  });
