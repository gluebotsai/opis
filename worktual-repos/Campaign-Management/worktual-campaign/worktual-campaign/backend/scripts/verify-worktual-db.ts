import "dotenv/config";
import { accountQuery } from "../src/plugins/account-pool.js";
import { prisma } from "../src/plugins/prisma.js";
import { ensureCampaignAccessForOrganization } from "../src/dao/entitlements.js";

async function main() {
  const users = await accountQuery<{ c: string }>(
    "SELECT count(*)::text AS c FROM accounts.setup_users",
  );
  const contacts = await accountQuery<{ c: string }>(
    "SELECT count(*)::text AS c FROM cdp.customer_profile",
  );
  const identities = await accountQuery<{ c: string }>(
    "SELECT count(*)::text AS c FROM cdp.identity_keys",
  );
  const configs = await accountQuery<{ c: string }>(
    "SELECT count(*)::text AS c FROM accounts.setup_channel_configs",
  );
  const branches = await prisma.branch.count();
  console.log(
    JSON.stringify({
      setup_users: users.rows[0]?.c,
      cdp_customer_profile: contacts.rows[0]?.c,
      cdp_identity_keys: identities.rows[0]?.c,
      channel_configs: configs.rows[0]?.c,
      campaign_branches: branches,
      db_host: (process.env.DATABASE_URL || "").split("@")[1]?.split("/")[0],
    }),
  );
  const org = await accountQuery<{ organization_id: string }>(
    `SELECT organization_id FROM accounts.setup_users WHERE status = 'active' LIMIT 1`,
  );
  const orgId = org.rows[0]?.organization_id;
  if (orgId) {
    const branchId = await ensureCampaignAccessForOrganization(orgId);
    console.log(JSON.stringify({ ensured_org: orgId, branchId }));
  }
  await prisma.$disconnect();
}

main().catch(async (e) => {
  console.error(e);
  try {
    await prisma.$disconnect();
  } catch {
    /* ignore */
  }
  process.exit(1);
});
