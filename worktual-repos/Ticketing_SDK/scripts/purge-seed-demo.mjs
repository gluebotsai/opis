#!/usr/bin/env node
/**
 * Remove leftover UUID seed-org demo data (pre-hub cutover org id).
 * Spoke tables only — never touches accounts.* / CDP / inventory.
 * Prints delete counts only (no row contents).
 */
import "dotenv/config";
import pg from "pg";

const SEED_ORG = "a0000000-0000-4000-8000-000000000001";
const KEEP_EMAIL = "jane.smith@worktual.com";

async function runDelete(client, label, sql, params) {
  try {
    const r = await client.query(sql, params);
    console.log(`deleted ${label}: ${r.rowCount}`);
  } catch (e) {
    console.log(`deleted ${label}: skipped (${e.message.split("\n")[0]})`);
  }
}

async function main() {
  const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  try {
    const steps = [
      [
        "ticket_notes",
        `DELETE FROM ticketing.ticket_notes
         WHERE organization_id::text = $1
            OR ticket_id IN (SELECT id FROM ticketing.tickets WHERE organization_id::text = $1)`,
        [SEED_ORG],
      ],
      [
        "activity_logs",
        `DELETE FROM ticketing.activity_logs WHERE organization_id::text = $1`,
        [SEED_ORG],
      ],
      [
        "audit_events",
        `DELETE FROM ticketing.audit_events WHERE organization_id::text = $1`,
        [SEED_ORG],
      ],
      [
        "notifications",
        `DELETE FROM ticketing.notifications WHERE organization_id::text = $1`,
        [SEED_ORG],
      ],
      [
        "macros",
        `DELETE FROM ticketing.macros WHERE organization_id::text = $1`,
        [SEED_ORG],
      ],
      [
        "tickets",
        `DELETE FROM ticketing.tickets WHERE organization_id::text = $1`,
        [SEED_ORG],
      ],
      [
        "contact_profile",
        `DELETE FROM ticketing.contact_profile WHERE organization_id::text = $1`,
        [SEED_ORG],
      ],
      [
        "kb_articles",
        `DELETE FROM ticketing.kb_articles WHERE organization_id::text = $1`,
        [SEED_ORG],
      ],
      [
        "agent_queues",
        `DELETE FROM ticketing.agent_queues WHERE organization_id::text = $1`,
        [SEED_ORG],
      ],
      [
        "dashboard_metrics",
        `DELETE FROM ticketing.dashboard_metrics WHERE organization_id::text = $1`,
        [SEED_ORG],
      ],
      [
        "org_settings",
        `DELETE FROM ticketing.org_settings WHERE organization_id::text = $1`,
        [SEED_ORG],
      ],
      [
        "demo_agents",
        `DELETE FROM ticketing.agents ag
         USING accounts.setup_users au
         WHERE ag.setup_user_id = au.id
           AND ag.organization_id::text = $1
           AND lower(COALESCE(au.work_email, '')) <> lower($2)`,
        [SEED_ORG, KEEP_EMAIL],
      ],
    ];

    for (const [label, sql, params] of steps) {
      await runDelete(client, label, sql, params);
    }

    const left = await client.query(
      `SELECT
         (SELECT COUNT(*)::int FROM ticketing.tickets WHERE organization_id::text=$1) AS tickets,
         (SELECT COUNT(*)::int FROM ticketing.contact_profile WHERE organization_id::text=$1) AS contacts,
         (SELECT COUNT(*)::int FROM ticketing.agent_queues WHERE organization_id::text=$1) AS queues,
         (SELECT COUNT(*)::int FROM ticketing.kb_articles WHERE organization_id::text=$1) AS kb,
         (SELECT COUNT(*)::int FROM ticketing.agents WHERE organization_id::text=$1) AS agents`,
      [SEED_ORG]
    );
    console.log("seed org remaining counts:", left.rows[0]);
    console.log("purge complete");
  } catch (e) {
    console.error(e);
    process.exitCode = 1;
  } finally {
    await client.end();
  }
}

main();
