/**
 * Backfill: enable live-agent handoff for persisted bot mailbox policies.
 *
 * Usage:
 *   npx tsx apps/cc-core/scripts/backfill-email-bot-live-agent.ts
 *   npx tsx apps/cc-core/scripts/backfill-email-bot-live-agent.ts --dry-run
 */
import "@ai-contact-center/config/load-root-env";
import { ccPrisma } from "@ai-contact-center/db-cc";

const dryRun = process.argv.includes("--dry-run");

const rows = await ccPrisma.$transaction(async (db) => {
  await db.$executeRaw`SELECT set_config('app.is_staff', 'true', true)`;
  return db.$queryRaw<
    Array<{
      organization_id: string;
      connection_id: string;
      account_email: string;
      bot_enabled: boolean;
      live_agent_enabled: boolean;
    }>
  >`
    SELECT organization_id, connection_id, account_email, bot_enabled, live_agent_enabled
    FROM ccass.email_mailbox_policies
    WHERE bot_enabled = TRUE
      AND live_agent_enabled = FALSE
      AND status = 'active'
    ORDER BY organization_id, connection_id
  `;
});

if (rows.length === 0) {
  console.log("No bot mailbox policies need live_agent_enabled backfill.");
  await ccPrisma.$disconnect();
  process.exit(0);
}

console.log(JSON.stringify({ dryRun, affected: rows.length, rows }, null, 2));

if (dryRun) {
  await ccPrisma.$disconnect();
  process.exit(0);
}

const updated = await ccPrisma.$transaction(async (db) => {
  await db.$executeRaw`SELECT set_config('app.is_staff', 'true', true)`;
  return db.$executeRaw`
    UPDATE ccass.email_mailbox_policies
    SET live_agent_enabled = TRUE, updated_at = NOW()
    WHERE bot_enabled = TRUE
      AND live_agent_enabled = FALSE
      AND status = 'active'
  `;
});

console.log(JSON.stringify({ updated }, null, 2));
await ccPrisma.$disconnect();
