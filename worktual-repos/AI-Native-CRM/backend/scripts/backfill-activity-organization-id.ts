/**
 * Fix contact_activities that landed on the legacy static DEFAULT org id.
 * Copies the real tenant from contact_profiles — never invents a tenant.
 *
 *   cd backend && npx tsx --env-file=../.env scripts/backfill-activity-organization-id.ts
 *   cd backend && npx tsx --env-file=../.env scripts/backfill-activity-organization-id.ts --apply
 */
import { prisma } from "../src/dao/db/prisma";

const LEGACY_STATIC_ORG =
  process.env.DEFAULT_ORGANIZATION_ID?.trim() ||
  "1000";

const apply = process.argv.includes("--apply");

async function main() {
  const stuck = await prisma.$queryRawUnsafe<Array<{ n: number | bigint }>>(
    `
    SELECT COUNT(*)::int AS n
    FROM contact_activities
    WHERE organization_id = $1::bigint
    `,
    LEGACY_STATIC_ORG,
  );
  const stuckCount = Number(stuck[0]?.n ?? 0);

  const matchable = await prisma.$queryRawUnsafe<Array<{ n: number | bigint }>>(
    `
    SELECT COUNT(*)::int AS n
    FROM contact_activities ca
    INNER JOIN contact_profiles cp
      ON cp.account_contact_id = ca.contact_id
    WHERE ca.organization_id = $1::bigint
      AND cp.organization_id IS NOT NULL
      AND cp.organization_id <> $1::bigint
    `,
    LEGACY_STATIC_ORG,
  );
  const matchableCount = Number(matchable[0]?.n ?? 0);

  console.log(
    JSON.stringify(
      {
        legacyStaticOrg: LEGACY_STATIC_ORG,
        activitiesOnLegacyOrg: stuckCount,
        canFixFromContactProfile: matchableCount,
        mode: apply ? "apply" : "dry-run",
      },
      null,
      2,
    ),
  );

  if (!apply) {
    console.log("Re-run with --apply to update rows.");
    return;
  }

  const updated = await prisma.$executeRawUnsafe(
    `
    UPDATE contact_activities ca
    SET organization_id = cp.organization_id,
        updated_at = NOW()
    FROM contact_profiles cp
    WHERE ca.contact_id = cp.account_contact_id
      AND ca.organization_id = $1::bigint
      AND cp.organization_id IS NOT NULL
      AND cp.organization_id <> $1::bigint
    `,
    LEGACY_STATIC_ORG,
  );

  console.log(JSON.stringify({ updatedRows: updated }, null, 2));
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
