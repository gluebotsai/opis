/**
 * Smoke test: multi-schema layout, prospect org on lead create, and RLS isolation.
 * Requires DATABASE_URL (from env or .env in project root).
 */
import "../src/config/load-env.js";
import { migrateDatabase } from "../src/db/migrate.js";
import { pool, withTransaction } from "../src/db/pool.js";
import {
  runWithOrganizationContext,
  runWithStaffContext,
} from "../src/db/tenantContext.js";
import { createProspectOrganization } from "../src/modules/organizations/organization-store.js";
import { insertLeadRow } from "../src/repositories/raw/leads.repo.js";
import { updateOrganizationSourceLead } from "../src/repositories/raw/organizations.repo.js";
import { applySmokeDbTimeouts } from "./lib/smokeDbTimeouts.mjs";

const EXPECTED_SCHEMAS = [
  "platform",
  "accounts",
  "crm",
  "cvm",
  "ticketing",
  "ccass",
  "cdp",
  "campaign",
];

const FAKE_ORG_ID = "00000000-0000-0000-0000-000000000099";
const marker = `rls-smoke-${Date.now()}`;
const tenantId = String(1000 + (Date.now() % 9000));

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

async function assertSchemas() {
  const { rows } = await pool.query(
    `SELECT nspname
     FROM pg_namespace
     WHERE nspname = ANY($1::text[])
     ORDER BY 1`,
    [EXPECTED_SCHEMAS],
  );
  const found = rows.map((row) => row.nspname);
  for (const name of EXPECTED_SCHEMAS) {
    assert(found.includes(name), `Missing schema: ${name}`);
  }
  console.log("[smoke-rls] schemas OK:", found.join(", "));
}

async function assertTableHomes() {
  const { rows } = await pool.query(
    `SELECT table_schema, table_name
     FROM information_schema.tables
     WHERE table_name IN ('users', 'leads', 'organizations', 'subscriptions')
       AND table_schema IN ('platform', 'accounts')
     ORDER BY table_name, table_schema`,
  );
  const byName = Object.fromEntries(rows.map((row) => [row.table_name, row.table_schema]));
  assert(byName.users === "platform", `users expected in platform, got ${byName.users}`);
  assert(byName.leads === "accounts", `leads expected in accounts, got ${byName.leads}`);
  assert(
    byName.organizations === "accounts",
    `organizations expected in accounts, got ${byName.organizations}`,
  );
  assert(
    byName.subscriptions === "accounts",
    `subscriptions expected in accounts, got ${byName.subscriptions}`,
  );
  console.log("[smoke-rls] table homes OK:", byName);
}

async function assertRlsForced() {
  const { rows } = await pool.query(
    `SELECT c.relname, c.relrowsecurity, c.relforcerowsecurity
     FROM pg_class c
     JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname = 'accounts'
       AND c.relname IN ('leads', 'organizations')
     ORDER BY c.relname`,
  );
  assert(rows.length === 2, "Expected RLS metadata for leads and organizations");
  for (const row of rows) {
    assert(row.relrowsecurity === true, `RLS not enabled on accounts.${row.relname}`);
    assert(row.relforcerowsecurity === true, `FORCE RLS not set on accounts.${row.relname}`);
  }
  console.log("[smoke-rls] FORCE RLS OK on accounts.leads / accounts.organizations");
}

async function assertSearchPath() {
  const { rows } = await pool.query(`SELECT current_schemas(true)::text AS schemas`);
  const raw = String(rows[0]?.schemas || "");
  assert(raw.includes("accounts"), `search_path missing accounts: ${raw}`);
  assert(raw.includes("platform"), `search_path missing platform: ${raw}`);
  console.log("[smoke-rls] search_path OK:", raw);
}

async function createProspectLead(client) {
  const org = await createProspectOrganization(client, {
    tenantId,
    companyName: `RLS Smoke ${marker}`,
    industryType: "IT",
    contactName: "RLS Tester",
    designation: "QA",
    workEmail: `${marker}@example.com`,
    adminEmail: `${marker}-admin@example.com`,
    taxNumber: "",
    billingAddress: "1 Smoke Street",
    websiteUrl: "",
    country: "India",
    companySize: "51-200",
    mobileCountryCode: "+91",
    mobileNumber: "9000000001",
    resellerId: null,
  });

  const lead = await insertLeadRow(client, [
    `RLS Smoke ${marker}`,
    "IT",
    "B2B",
    "RLS Tester",
    "QA",
    `${marker}@example.com`,
    `${marker}-admin@example.com`,
    "",
    "1 Smoke Street",
    "",
    "India",
    "Karnataka",
    "51-200",
    true,
    "",
    "+91",
    "9000000001",
    "+91",
    "",
    "New",
    true,
    tenantId,
    null,
    null,
    null,
    null,
    null,
    org.id,
  ]);

  await updateOrganizationSourceLead(client, org.id, lead.id);
  return { lead, org };
}

async function cleanup(leadId, organizationId) {
  await runWithStaffContext(async () => {
    const client = await pool.connect();
    try {
      if (organizationId) {
        await client.query(
          `UPDATE organizations SET source_lead_id = NULL, updated_at = NOW() WHERE id = $1`,
          [organizationId],
        );
      }
      if (leadId) {
        await client.query(
          `UPDATE leads
           SET organization_id = NULL, converted_organization_id = NULL, updated_at = NOW()
           WHERE id = $1`,
          [leadId],
        );
        await client.query(`DELETE FROM lead_assignments WHERE lead_id = $1`, [leadId]);
        await client.query(`DELETE FROM additional_addresses WHERE lead_id = $1`, [leadId]);
        await client.query(`DELETE FROM branches WHERE lead_id = $1`, [leadId]);
        await client.query(`DELETE FROM leads WHERE id = $1`, [leadId]);
      }
      if (organizationId) {
        await client.query(`DELETE FROM organization_locations WHERE organization_id = $1`, [
          organizationId,
        ]);
        await client.query(`DELETE FROM organizations WHERE id = $1`, [organizationId]);
      }
    } finally {
      client.release();
    }
  });
}

async function main() {
  if (!process.env.DATABASE_URL) {
    console.error("[smoke-rls] DATABASE_URL is not set");
    process.exit(1);
  }

  applySmokeDbTimeouts(pool);
  await migrateDatabase();

  let leadId = null;
  let organizationId = null;

  try {
    await assertSchemas();
    await assertTableHomes();
    await assertRlsForced();
    await assertSearchPath();

    const created = await withTransaction(async (client) => createProspectLead(client));
    leadId = created.lead.id;
    organizationId = created.org.id;

    assert(created.lead.organization_id === organizationId, "lead.organization_id mismatch");
    assert(
      created.org.lifecycleStatus === "prospect" || created.org.lifecycle_status === "prospect",
      `expected prospect org, got ${created.org.lifecycleStatus || created.org.lifecycle_status}`,
    );

    const { rows: orgRows } = await pool.query(
      `SELECT lifecycle_status FROM organizations WHERE id = $1`,
      [organizationId],
    );
    assert(orgRows[0]?.lifecycle_status === "prospect", "org lifecycle_status should be prospect");
    console.log("[smoke-rls] prospect org + lead.organization_id OK");

    const staffCount = await runWithStaffContext(async () => {
      const { rows } = await pool.query(
        `SELECT count(*)::int AS c FROM leads WHERE id = $1`,
        [leadId],
      );
      return rows[0].c;
    });
    assert(staffCount === 1, `staff should see lead, got count=${staffCount}`);

  const otherTenantCount = await runWithOrganizationContext(FAKE_ORG_ID, async () => {
    const { rows } = await pool.query(
      `SELECT count(*)::int AS c FROM leads WHERE id = $1`,
      [leadId],
    );
    return rows[0].c;
  });

  const { rows: roleRows } = await pool.query(
    `SELECT current_user AS role,
            (SELECT rolsuper FROM pg_roles WHERE rolname = current_user) AS is_super`,
  );
  if (roleRows[0]?.is_super) {
    console.warn(
      `[smoke-rls] WARN: DB user "${roleRows[0].role}" is a superuser — RLS isolation cannot be enforced; skipping cross-tenant assert`,
    );
  } else {
    assert(
      otherTenantCount === 0,
      `other tenant should see 0 leads, got count=${otherTenantCount}`,
    );
  }

    const ownerCount = await runWithOrganizationContext(organizationId, async () => {
      const { rows } = await pool.query(
        `SELECT count(*)::int AS c FROM leads WHERE id = $1`,
        [leadId],
      );
      return rows[0].c;
    });
    assert(ownerCount === 1, `owner tenant should see lead, got count=${ownerCount}`);

    console.log("[smoke-rls] isolation OK:", {
      staffCount,
      otherTenantCount,
      ownerCount,
    });
    console.log("[smoke-rls] OK — multi-schema + prospect org + RLS isolation");
  } catch (error) {
    console.error("[smoke-rls] FAILED:", error);
    process.exitCode = 1;
  } finally {
    try {
      await cleanup(leadId, organizationId);
    } catch (cleanupError) {
      console.warn(
        "[smoke-rls] cleanup warning:",
        cleanupError instanceof Error ? cleanupError.message : cleanupError,
      );
    }
    await pool.end();
  }

  if (process.exitCode) {
    process.exit(process.exitCode);
  }
}

main();
