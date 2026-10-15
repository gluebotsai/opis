/**
 * Purge all channel interactions and CDP contacts for an organization.
 * Does NOT remove queues, agents, or channel config.
 *
 * Usage:
 *   ORGANIZATION_ID=1000 npx tsx apps/cc-core/scripts/purge-org-interactions-and-contacts.ts
 *   ORGANIZATION_ID=1000 npx tsx apps/cc-core/scripts/purge-org-interactions-and-contacts.ts --live
 */
import "@ai-contact-center/config/load-root-env";
import { ccPrisma } from "@ai-contact-center/db-cc";

const ORG_ID = process.env.ORGANIZATION_ID ?? "1000";
const live = process.argv.includes("--live");

function serialize(value: unknown): string {
  return JSON.stringify(value, (_key, current) =>
    typeof current === "bigint" ? current.toString() : current,
  );
}

async function setContext(db: typeof ccPrisma) {
  await db.$executeRaw`SELECT set_config('app.is_staff', 'true', true)`;
  await db.$executeRaw`SELECT set_config('app.organization_id', ${ORG_ID}, true)`;
  await db.$executeRaw`SELECT set_config('app.current_org_id', ${ORG_ID}, true)`;
}

async function previewCounts() {
  await setContext(ccPrisma);
  const rows = await ccPrisma.$queryRaw<
    Array<Record<string, number>>
  >`
    SELECT
      (SELECT COUNT(*)::int FROM ccass.conversations WHERE organization_id = ${ORG_ID}::bigint) AS conversations,
      (SELECT COUNT(*)::int FROM ccass.conversation_messages m
        JOIN ccass.conversations c ON c.id = m.conversation_id
        WHERE c.organization_id = ${ORG_ID}::bigint) AS messages,
      (SELECT COUNT(*)::int FROM cdp.interactions WHERE organization_id = ${ORG_ID}::bigint) AS interactions,
      (SELECT COUNT(*)::int FROM cdp.interaction_events WHERE organization_id = ${ORG_ID}::bigint) AS interaction_events,
      (SELECT COUNT(*)::int FROM ccass.routing_attempts WHERE organization_id = ${ORG_ID}::bigint) AS routing_attempts,
      (SELECT COUNT(*)::int FROM ccass.agent_tasks WHERE organization_id = ${ORG_ID}::bigint) AS agent_tasks,
      (SELECT COUNT(*)::int FROM ccass.agent_missed_contacts WHERE organization_id = ${ORG_ID}::bigint) AS missed_contacts,
      (SELECT COUNT(*)::int FROM ccass.copilot_sessions WHERE organization_id = ${ORG_ID}::bigint) AS copilot_sessions,
      (SELECT COUNT(*)::int FROM ccass.message_delivery_attempts WHERE organization_id = ${ORG_ID}::bigint) AS delivery_attempts,
      (SELECT COUNT(*)::int FROM cdp.customer_profile WHERE organization_id = ${ORG_ID}::bigint) AS customer_profiles,
      (SELECT COUNT(*)::int FROM cdp.identity_keys WHERE organization_id = ${ORG_ID}::bigint) AS identity_keys
  `;
  return rows[0] ?? {};
}

async function purge(db: typeof ccPrisma) {
  await setContext(db);

  await db.$executeRaw`
    DELETE FROM cdp.interaction_events WHERE organization_id = ${ORG_ID}::bigint
  `;
  await db.$executeRaw`
    DELETE FROM cdp.interactions WHERE organization_id = ${ORG_ID}::bigint
  `;

  await db.$executeRaw`
    DELETE FROM ccass.message_delivery_attempts WHERE organization_id = ${ORG_ID}::bigint
  `;
  await db.$executeRaw`
    DELETE FROM ccass.agent_missed_contacts WHERE organization_id = ${ORG_ID}::bigint
  `;
  await db.$executeRaw`
    DELETE FROM ccass.agent_tasks WHERE organization_id = ${ORG_ID}::bigint
  `;
  await db.$executeRaw`
    DELETE FROM ccass.email_provider_events WHERE organization_id = ${ORG_ID}::bigint
  `;
  await db.$executeRaw`
    DELETE FROM ccass.email_delivery_outbox WHERE organization_id = ${ORG_ID}::bigint
  `;
  await db.$executeRaw`
    DELETE FROM ccass.routing_attempts WHERE organization_id = ${ORG_ID}::bigint
  `;
  await db.$executeRaw`
    DELETE FROM ccass.conversations WHERE organization_id = ${ORG_ID}::bigint
  `;

  await db.$executeRaw`
    DELETE FROM ccass.copilot_sessions WHERE organization_id = ${ORG_ID}::bigint
  `;
  await db.$executeRaw`
    DELETE FROM ccass.copilot_memory WHERE organization_id = ${ORG_ID}::bigint
  `;

  await db.$executeRaw`
    DELETE FROM cdp.identity_keys WHERE organization_id = ${ORG_ID}::bigint
  `;
  await db.$executeRaw`
    DELETE FROM cdp.gold_customer_metrics
    WHERE cdp_id IN (
      SELECT cdp_id FROM cdp.customer_profile WHERE organization_id = ${ORG_ID}::bigint
    )
  `;
  await db.$executeRaw`
    DELETE FROM cdp.customer_journey WHERE organization_id = ${ORG_ID}::bigint
  `;
  await db.$executeRaw`
    DELETE FROM public.customer_journey WHERE organization_id = ${ORG_ID}::bigint
  `;
  await db.$executeRaw`
    DELETE FROM cdp.journey_states WHERE organization_id = ${ORG_ID}::bigint
  `;
  await db.$executeRaw`
    DELETE FROM public.journey_states WHERE organization_id = ${ORG_ID}::bigint
  `;
  await db.$executeRaw`
    DELETE FROM public.activation_tasks WHERE organization_id = ${ORG_ID}::bigint
  `;
  await db.$executeRaw`
    DELETE FROM cdp.customer_profile WHERE organization_id = ${ORG_ID}::bigint
  `;

  await db.$executeRaw`
    UPDATE ccass.agent_capacity ac
    SET active_count = 0, reserved_count = 0, updated_at = NOW()
    FROM ccass.agents a
    WHERE ac.agent_id = a.id AND a.organization_id = ${ORG_ID}::bigint
  `;
  await db.$executeRaw`
    UPDATE ccass.agent_presence ap
    SET presence_state = 'offline', status = 'offline', reason_code = NULL, updated_at = NOW()
    FROM ccass.agents a
    WHERE ap.agent_id = a.id AND a.organization_id = ${ORG_ID}::bigint
  `;
}

async function main() {
  const before = await previewCounts();
  console.log(serialize({ organizationId: ORG_ID, live, before }));

  if (!live) {
    console.log("\nDry run only. Re-run with --live to purge.");
    return;
  }

  await purge(ccPrisma);

  const after = await previewCounts();
  console.log(serialize({ status: "complete", after }));
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await ccPrisma.$disconnect();
  });
