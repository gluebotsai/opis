/**
 * Remove the org-1003 demo book created by seed-demo-revenue-org-1003.ts.
 * Does not touch login users, org 1003, or inventory.products.
 *
 * Run from backend/:
 *   npx tsx --tsconfig tsconfig.json --env-file=../.env scripts/purge-demo-revenue-org-1003.ts
 */
import { Pool } from "pg";

const ORG = "1003";

function accountUrl(): string {
  const url = process.env.ACCOUNT_DATABASE_URL?.trim() || process.env.DATABASE_URL?.trim();
  if (!url) {
    throw new Error("ACCOUNT_DATABASE_URL or DATABASE_URL is required.");
  }
  return url;
}

async function main() {
  const pool = new Pool({ connectionString: accountUrl() });
  const client = await pool.connect();
  try {
    const before = await client.query(
      `SELECT
         (SELECT count(*) FROM crm.companies WHERE organization_id = $1::bigint AND id LIKE 'demo1003-%') AS companies,
         (SELECT count(*) FROM crm.deals WHERE organization_id = $1::bigint AND id LIKE 'demo1003-%') AS deals,
         (SELECT count(*) FROM crm.invoices WHERE organization_id = $1::bigint AND id LIKE 'demo1003-%') AS invoices,
         (SELECT count(*) FROM crm.quotes WHERE organization_id = $1::bigint AND id LIKE 'demo1003-%') AS quotes,
         (SELECT count(*) FROM crm.contact_profiles WHERE organization_id = $1::bigint AND (lead_source = 'demo-revenue' OR account_contact_id LIKE 'CDP-crm-org1003-demo1003ct%')) AS contacts,
         (SELECT count(*) FROM cdp.customer_profile WHERE organization_id = $1::bigint AND (cdp_id LIKE 'CDP-crm-org1003-demo1003ct%' OR acquisition_channel = 'demo-revenue')) AS cdp`,
      [ORG],
    );
    console.log("before", before.rows[0]);

    await client.query("BEGIN");

    await client.query(
      `DELETE FROM crm.invoice_lines WHERE organization_id = $1::bigint AND id LIKE 'demo1003-%'`,
      [ORG],
    );
    await client.query(
      `DELETE FROM crm.quote_lines WHERE organization_id = $1::bigint AND id LIKE 'demo1003-%'`,
      [ORG],
    );
    await client.query(
      `DELETE FROM crm.invoices WHERE organization_id = $1::bigint AND id LIKE 'demo1003-%'`,
      [ORG],
    );
    await client.query(
      `DELETE FROM crm.quotes WHERE organization_id = $1::bigint AND id LIKE 'demo1003-%'`,
      [ORG],
    );
    await client.query(
      `DELETE FROM crm.order_lines WHERE organization_id = $1::bigint AND id LIKE 'demo1003-%'`,
      [ORG],
    );
    await client.query(
      `DELETE FROM crm.sales_orders WHERE organization_id = $1::bigint AND id LIKE 'demo1003-%'`,
      [ORG],
    );
    await client.query(
      `DELETE FROM crm.deal_activities WHERE organization_id = $1::bigint AND deal_id LIKE 'demo1003-%'`,
      [ORG],
    );
    await client.query(
      `DELETE FROM crm.contact_activities
       WHERE organization_id = $1::bigint
         AND (
           contact_id LIKE 'CDP-crm-org1003-demo1003ct%'
           OR contact_id IN (
             SELECT id FROM crm.contact_profiles
             WHERE organization_id = $1::bigint
               AND account_contact_id LIKE 'CDP-crm-org1003-demo1003ct%'
           )
         )`,
      [ORG],
    );

    for (const table of [
      "lead_scoring_jobs",
      "lead_summaries",
      "lead_summary_refresh_queue",
      "lead_enrichment_jobs",
      "lead_enrichment_snapshots",
      "lead_nurture_jobs",
      "lead_lifecycle_jobs",
    ]) {
      await client.query(
        `DELETE FROM crm.${table}
         WHERE organization_id = $1::bigint
           AND contact_id LIKE 'CDP-crm-org1003-demo1003ct%'`,
        [ORG],
      );
    }

    await client.query(
      `UPDATE crm.contact_profiles
       SET converted_deal_id = NULL
       WHERE organization_id = $1::bigint AND converted_deal_id LIKE 'demo1003-%'`,
      [ORG],
    );
    await client.query(
      `DELETE FROM crm.deals WHERE organization_id = $1::bigint AND id LIKE 'demo1003-%'`,
      [ORG],
    );
    await client.query(
      `DELETE FROM crm.contact_profiles
       WHERE organization_id = $1::bigint
         AND (
           lead_source = 'demo-revenue'
           OR account_contact_id LIKE 'CDP-crm-org1003-demo1003ct%'
         )`,
      [ORG],
    );
    await client.query(
      `DELETE FROM cdp.identity_keys
       WHERE organization_id = $1::bigint
         AND (
           identity_id LIKE 'demo1003-email-%'
           OR cdp_id LIKE 'CDP-crm-org1003-demo1003ct%'
         )`,
      [ORG],
    );
    await client.query(
      `DELETE FROM cdp.customer_profile
       WHERE organization_id = $1::bigint
         AND (
           cdp_id LIKE 'CDP-crm-org1003-demo1003ct%'
           OR acquisition_channel = 'demo-revenue'
         )`,
      [ORG],
    );
    await client.query(
      `DELETE FROM crm.company_locations WHERE organization_id = $1::bigint AND id LIKE 'demo1003-%'`,
      [ORG],
    );
    await client.query(
      `DELETE FROM crm.companies WHERE organization_id = $1::bigint AND id LIKE 'demo1003-%'`,
      [ORG],
    );

    await client.query("COMMIT");

    const after = await client.query(
      `SELECT
         (SELECT count(*) FROM crm.companies WHERE organization_id = $1::bigint AND id LIKE 'demo1003-%') AS companies,
         (SELECT count(*) FROM crm.deals WHERE organization_id = $1::bigint AND id LIKE 'demo1003-%') AS deals,
         (SELECT count(*) FROM crm.invoices WHERE organization_id = $1::bigint AND id LIKE 'demo1003-%') AS invoices,
         (SELECT count(*) FROM crm.quotes WHERE organization_id = $1::bigint AND id LIKE 'demo1003-%') AS quotes,
         (SELECT count(*) FROM crm.contact_profiles WHERE organization_id = $1::bigint AND (lead_source = 'demo-revenue' OR account_contact_id LIKE 'CDP-crm-org1003-demo1003ct%')) AS contacts,
         (SELECT count(*) FROM cdp.customer_profile WHERE organization_id = $1::bigint AND (cdp_id LIKE 'CDP-crm-org1003-demo1003ct%' OR acquisition_channel = 'demo-revenue')) AS cdp`,
      [ORG],
    );
    console.log("after", after.rows[0]);
  } catch (err) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw err;
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
