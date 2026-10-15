import "@ai-contact-center/config/load-root-env";
import { ccPrisma } from "@ai-contact-center/db-cc";

import { mergeContacts } from "../src/services/contact-merge.js";

const ORG = process.env.ORGANIZATION_ID ?? "ce4ff326-4c0e-43f2-a978-e6b494cd0775";
const WINNER = process.env.WINNER_CONTACT_ID ?? "44109b9e-9636-497c-bf0b-149e77958add";
const LOSER = process.env.LOSER_CONTACT_ID ?? "8d4cbc77-7dbf-4b8e-af37-30f6dfd70163";
const dryRun = process.argv.includes("--dry-run");

function serialize(value: unknown): string {
  return JSON.stringify(
    value,
    (_key, current) => (typeof current === "bigint" ? Number(current) : current),
    2,
  );
}

async function preview() {
  await ccPrisma.$executeRaw`SELECT set_config('app.is_staff', 'true', true)`;
  await ccPrisma.$executeRaw`SELECT set_config('app.organization_id', ${ORG}, true)`;

  const profiles = await ccPrisma.$queryRaw<
    Array<{
      cdp_id: string;
      first_name: string | null;
      last_name: string | null;
      custom_fields: Record<string, unknown> | null;
    }>
  >`
    SELECT cdp_id, first_name, last_name, custom_fields
    FROM cdp.customer_profile
    WHERE organization_id = ${ORG}::bigint
      AND cdp_id IN (${WINNER}::text, ${LOSER}::text)
  `;

  const keys = await ccPrisma.$queryRaw<
    Array<{ cdp_id: string; key_type: string; key_value: string }>
  >`
    SELECT cdp_id, key_type, key_value
    FROM cdp.identity_keys
    WHERE organization_id = ${ORG}::bigint
      AND cdp_id IN (${WINNER}::text, ${LOSER}::text)
    ORDER BY cdp_id, key_type
  `;

  const conversations = await ccPrisma.$queryRaw<
    Array<{ contact_id: string | null; channel: string; count: bigint }>
  >`
    SELECT contact_id, channel, COUNT(*)::bigint AS count
    FROM ccass.conversations
    WHERE organization_id = ${ORG}::bigint
      AND contact_id IN (${WINNER}::bigint, ${LOSER}::bigint)
    GROUP BY contact_id, channel
    ORDER BY contact_id, channel
  `;

  const interactions = await ccPrisma.$queryRaw<
    Array<{ contact_id: string; count: bigint }>
  >`
    SELECT contact_id, COUNT(*)::bigint AS count
    FROM cdp.interactions
    WHERE organization_id = ${ORG}::bigint
      AND contact_id IN (${WINNER}::bigint, ${LOSER}::bigint)
    GROUP BY contact_id
    ORDER BY contact_id
  `;

  console.log(
    serialize({
      dryRun,
      organizationId: ORG,
      winnerId: WINNER,
      loserId: LOSER,
      profiles,
      identityKeys: keys,
      conversations,
      interactions,
    }),
  );
}

async function main() {
  await preview();
  if (dryRun) {
    console.log("Dry run only — no merge executed.");
    return;
  }

  const result = await ccPrisma.$transaction(async (db) => {
    await db.$executeRaw`SELECT set_config('app.is_staff', 'true', true)`;
    await db.$executeRaw`SELECT set_config('app.organization_id', ${ORG}, true)`;
    return mergeContacts(db, ORG, {
      winnerId: WINNER,
      loserId: LOSER,
      reason: "manual_repair_duplicate_profiles",
    });
  });

  console.log("Merge complete:", serialize(result));
  await preview();
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => ccPrisma.$disconnect());
