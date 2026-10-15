/**
 * Backfill `cdp.customer_profile` + `cdp.identity_keys` from existing ccass conversations.
 * Preserves existing `contact_id` values as `cdp_id` so inbox links stay intact.
 *
 * Usage:
 *   npx tsx apps/cc-core/scripts/backfill-customer-profiles.ts
 *   npx tsx apps/cc-core/scripts/backfill-customer-profiles.ts --org-id <uuid>
 *   npx tsx apps/cc-core/scripts/backfill-customer-profiles.ts --all-orgs
 *   npx tsx apps/cc-core/scripts/backfill-customer-profiles.ts --dry-run
 */
import "@ai-contact-center/config/load-root-env";
import { ccPrisma } from "@ai-contact-center/db-cc";

import { backfillCustomerProfilesFromConversations } from "../src/services/backfill-customer-profiles.js";
import { withOrganizationContext, withStaffContext } from "../src/lib/rls.js";

const WORKTUAL_ORG_ID = "ce4ff326-4c0e-43f2-a978-e6b494cd0775";

function readArg(name: string): string | undefined {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

const organizationId = readArg("org-id") ?? process.env.ORGANIZATION_ID ?? WORKTUAL_ORG_ID;
const dryRun = process.argv.includes("--dry-run");
const allOrgs = process.argv.includes("--all-orgs");

async function setCdpSessionContext(db: Parameters<typeof backfillCustomerProfilesFromConversations>[0], orgId: string) {
  await db.$executeRaw`SELECT set_config('app.organization_id', ${orgId}, true)`;
  await db.$executeRaw`SELECT set_config('app.current_org_id', ${orgId}, true)`;
}

async function backfillOrg(orgId: string) {
  return withOrganizationContext(ccPrisma, orgId, async (db) => {
    await setCdpSessionContext(db, orgId);
    return backfillCustomerProfilesFromConversations(db, { organizationId: orgId, dryRun });
  });
}

async function backfillAllOrgs() {
  const orgRows = await withStaffContext(ccPrisma, async (db) =>
    db.$queryRaw<Array<{ organization_id: string }>>`
      SELECT DISTINCT organization_id
      FROM ccass.conversations
      ORDER BY organization_id
    `,
  );

  const results: Record<string, Awaited<ReturnType<typeof backfillOrg>>> = {};
  for (const row of orgRows) {
    results[row.organization_id] = await backfillOrg(row.organization_id);
  }
  return results;
}

async function main() {
  const result = allOrgs ? await backfillAllOrgs() : await backfillOrg(organizationId);

  console.log(
    JSON.stringify(
      {
        organizationId: allOrgs ? "all" : organizationId,
        dryRun,
        result,
      },
      null,
      2,
    ),
  );
}

main()
  .catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  })
  .finally(async () => {
    await ccPrisma.$disconnect();
  });
