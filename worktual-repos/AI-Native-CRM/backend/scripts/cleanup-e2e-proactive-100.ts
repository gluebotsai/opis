/**
 * Remove E2E proactive test contacts (leadSource=e2e_proactive_100) and CRM/CDP rows.
 *
 * Run (preview): npx tsx --env-file=../.env scripts/cleanup-e2e-proactive-100.ts --dry-run
 * Run (delete):  npx tsx --env-file=../.env scripts/cleanup-e2e-proactive-100.ts
 * CDP finish:    npx tsx --env-file=../.env scripts/cleanup-e2e-proactive-100.ts --cdp-only
 */
import pg from "pg";
import { deleteContact } from "../src/dao/contacts/contact-service.ts";

const LEAD_SOURCE = "e2e_proactive_100";
const EMAIL_LIKE = "e2e100-%@example.test";
const DEAL_TITLE_LIKE = "E2E e2e100-%";
const dryRun = process.argv.includes("--dry-run");

async function findE2eContactIds(client: pg.Client): Promise<string[]> {
  const { rows } = await client.query<{ id: string }>(
    `
    SELECT DISTINCT id FROM (
      SELECT cp.account_contact_id::text AS id
      FROM crm.contact_profiles cp
      WHERE cp.lead_source = $1
      UNION
      SELECT k.cdp_id::text AS id
      FROM cdp.identity_keys k
      WHERE k.key_type = 'email' AND k.key_value LIKE $2
    ) t
    ORDER BY id
    `,
    [LEAD_SOURCE, EMAIL_LIKE],
  );
  return rows.map((r) => r.id);
}

async function countRemaining(client: pg.Client): Promise<Record<string, number>> {
  const checks: Array<[string, string, unknown[]]> = [
    [
      "contact_profiles",
      `SELECT count(*)::int AS n FROM crm.contact_profiles WHERE lead_source = $1`,
      [LEAD_SOURCE],
    ],
    [
      "identity_keys",
      `SELECT count(*)::int AS n FROM cdp.identity_keys WHERE key_value LIKE $1`,
      [EMAIL_LIKE],
    ],
    [
      "lead_enrichment_jobs",
      `
      SELECT count(*)::int AS n
      FROM crm.lead_enrichment_jobs j
      WHERE j.contact_id IN (
        SELECT cp.account_contact_id::text
        FROM crm.contact_profiles cp
        WHERE cp.lead_source = $1
      )
      OR j.contact_id IN (
        SELECT k.cdp_id::text FROM cdp.identity_keys k
        WHERE k.key_type = 'email' AND k.key_value LIKE $2
      )
      `,
      [LEAD_SOURCE, EMAIL_LIKE],
    ],
    [
      "e2e_deals",
      `SELECT count(*)::int AS n FROM crm.deals WHERE title LIKE $1`,
      [DEAL_TITLE_LIKE],
    ],
  ];

  const out: Record<string, number> = {};
  for (const [key, sql, params] of checks) {
    const { rows } = await client.query<{ n: number }>(sql, params);
    out[key] = rows[0]?.n ?? 0;
  }
  return out;
}

async function deleteCrmSatellites(
  client: pg.Client,
  ids: string[],
): Promise<void> {
  const tables = [
    "process_confirmations",
    "meeting_assist_sessions",
    "agent_step_events",
    "lead_enrichment_jobs",
    "lead_scoring_jobs",
    "lead_nurture_jobs",
    "lead_lifecycle_jobs",
    "lead_summaries",
    "lead_enrichment_snapshots",
    "email_auto_reply_jobs",
    "privacy_requests",
    "meeting_analyses",
    "coaching_insights",
    "notifications",
  ];

  for (const table of tables) {
    const { rowCount } = await client.query(
      `DELETE FROM crm.${table} WHERE contact_id = ANY($1::text[])`,
      [ids],
    );
    console.log(`  crm.${table}: ${rowCount ?? 0}`);
  }

  const agentMem = await client.query(
    `DELETE FROM crm.agent_memories
     WHERE scope_type = 'contact' AND scope_id = ANY($1::text[])`,
    [ids],
  );
  console.log(`  crm.agent_memories: ${agentMem.rowCount ?? 0}`);

  const analysesByActivity = await client.query(
    `
    DELETE FROM crm.meeting_analyses ma
    WHERE ma.activity_id IN (
      SELECT a.id FROM crm.contact_activities a WHERE a.contact_id = ANY($1::text[])
    )
    `,
    [ids],
  );
  console.log(`  crm.meeting_analyses (by activity): ${analysesByActivity.rowCount ?? 0}`);

  const coachingByActivity = await client.query(
    `
    DELETE FROM crm.coaching_insights ci
    WHERE ci.activity_id IN (
      SELECT a.id FROM crm.contact_activities a WHERE a.contact_id = ANY($1::text[])
    )
    `,
    [ids],
  );
  console.log(`  crm.coaching_insights (by activity): ${coachingByActivity.rowCount ?? 0}`);

  const deals = await client.query(
    `
    DELETE FROM crm.deals
    WHERE contact_id = ANY($1::text[])
       OR title LIKE $2
    `,
    [ids, DEAL_TITLE_LIKE],
  );
  console.log(`  crm.deals: ${deals.rowCount ?? 0}`);
}

async function deleteCrmProfiles(client: pg.Client, ids: string[]): Promise<number> {
  const { rowCount } = await client.query(
    `DELETE FROM crm.contact_profiles WHERE account_contact_id::text = ANY($1::text[])`,
    [ids],
  );
  console.log(`  crm.contact_profiles: ${rowCount ?? 0}`);
  return rowCount ?? 0;
}

async function listCdpChildTables(client: pg.Client): Promise<
  Array<{ table_schema: string; table_name: string }>
> {
  const { rows } = await client.query<{ table_schema: string; table_name: string }>(
    `
    SELECT DISTINCT tc.table_schema, tc.table_name
    FROM information_schema.table_constraints AS tc
    JOIN information_schema.key_column_usage AS kcu
      ON tc.constraint_name = kcu.constraint_name
     AND tc.table_schema = kcu.table_schema
    JOIN information_schema.constraint_column_usage AS ccu
      ON ccu.constraint_name = tc.constraint_name
    WHERE tc.constraint_type = 'FOREIGN KEY'
      AND ccu.table_schema = 'cdp'
      AND ccu.table_name = 'customer_profile'
      AND tc.table_name <> 'identity_keys'
    ORDER BY 1, 2
    `,
  );
  return rows;
}

async function deleteCdpPersons(client: pg.Client, ids: string[]): Promise<number> {
  const childTables = await listCdpChildTables(client);
  const extra = [{ table_schema: "public", table_name: "activation_tasks" }];
  const seen = new Set<string>();
  const queue = [...childTables, ...extra].filter(({ table_schema, table_name }) => {
    const key = `${table_schema}.${table_name}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  for (const { table_schema, table_name } of queue) {
    const qualified = `${table_schema}.${table_name}`;
    try {
      const { rowCount } = await client.query(
        `DELETE FROM ${qualified} WHERE cdp_id = ANY($1::text[])`,
        [ids],
      );
      if ((rowCount ?? 0) > 0) {
        console.log(`  ${qualified}: ${rowCount}`);
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.warn(`  skip ${qualified}: ${msg}`);
    }
  }

  const profiles = await client.query(
    `DELETE FROM cdp.customer_profile WHERE cdp_id = ANY($1::text[])`,
    [ids],
  );
  console.log(`  cdp.customer_profile: ${profiles.rowCount ?? 0}`);
  return profiles.rowCount ?? 0;
}

async function main() {
  const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();

  const before = await countRemaining(client);
  console.log("Before:", before);

  const ids = await findE2eContactIds(client);
  console.log(`Found ${ids.length} E2E contact(s)`);
  if (ids.length > 0) {
    console.log(`  sample: ${ids.slice(0, 3).join(", ")}${ids.length > 3 ? " …" : ""}`);
  }

  if (ids.length === 0) {
    console.log("Nothing to delete.");
    await client.end();
    return;
  }

  const skipContactPass = process.argv.includes("--cdp-only");

  if (dryRun) {
    console.log("--dry-run: no deletes performed.");
    await client.end();
    return;
  }

  if (!skipContactPass) {
    console.log("\nDeleting CRM satellite rows…");
    await deleteCrmSatellites(client, ids);
    await client.end();

    console.log("\nDeleting contacts (activities + CDP + profile)…");
    let deleted = 0;
    let errors = 0;
    for (const id of ids) {
      try {
        await deleteContact(id);
        deleted += 1;
        if (deleted % 10 === 0) console.log(`  ${deleted}/${ids.length}`);
      } catch (err) {
        console.error(`  failed ${id}:`, err instanceof Error ? err.message : err);
        errors += 1;
      }
    }
    console.log(`Contact delete pass: ${deleted}, errors: ${errors}`);
  } else {
    await client.end();
  }

  console.log("\nFinal CRM profile + CDP hard delete…");
  const finalClient = new pg.Client({ connectionString: process.env.DATABASE_URL });
  await finalClient.connect();
  await deleteCrmProfiles(finalClient, ids);
  const cdpRemoved = await deleteCdpPersons(finalClient, ids);
  await finalClient.end();
  console.log(`CDP persons removed: ${cdpRemoved}`);

  const verify = new pg.Client({ connectionString: process.env.DATABASE_URL });
  await verify.connect();
  const after = await countRemaining(verify);
  const remainingIds = await findE2eContactIds(verify);
  await verify.end();
  console.log("\nAfter:", after);
  if (remainingIds.length > 0) {
    console.log(`Remaining E2E contact ids: ${remainingIds.length}`);
  }

  if (Object.values(after).some((n) => n > 0) || remainingIds.length > 0) {
    console.error("Cleanup incomplete — some rows remain.");
    process.exitCode = 1;
  } else {
    console.log("Cleanup complete.");
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
