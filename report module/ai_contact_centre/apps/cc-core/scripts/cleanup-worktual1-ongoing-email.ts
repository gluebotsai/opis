/**
 * Remove ongoing email conversations for worktual1 org (and related CDP rows).
 *
 * Usage:
 *   npx tsx scripts/cleanup-worktual1-ongoing-email.ts
 *   npx tsx scripts/cleanup-worktual1-ongoing-email.ts --live
 */
import "@ai-contact-center/config/load-root-env";
import { ccPrisma } from "@ai-contact-center/db-cc";

const ORG_ID = process.env.ORGANIZATION_ID ?? "ce4ff326-4c0e-43f2-a978-e6b494cd0775";
const QUEUE_ID = process.env.WEBCHAT_QUEUE_ID ?? "81019f3d-826b-498f-8273-18abe4df6dba";
const live = process.argv.includes("--live");

async function main() {
  await ccPrisma.$executeRaw`SELECT set_config('app.is_staff', 'true', true)`;
  await ccPrisma.$executeRaw`SELECT set_config('app.organization_id', ${ORG_ID}, true)`;

  const preview = await ccPrisma.$queryRaw<
    Array<{ id: string; status: string; visitor_id: string | null; subject: string | null }>
  >`
    SELECT id, status, visitor_id, subject
    FROM ccass.conversations
    WHERE organization_id = ${ORG_ID}::bigint
      AND channel = 'email'
      AND status NOT IN ('resolved', 'closed')
      AND queue_id = ${QUEUE_ID}::bigint
    ORDER BY updated_at DESC
  `;

  console.log(
    JSON.stringify(
      {
        organizationId: ORG_ID,
        queueId: QUEUE_ID,
        live,
        ongoingEmailCount: preview.length,
        sample: preview.slice(0, 5).map((row) => ({
          id: row.id,
          status: row.status,
          visitorId: row.visitor_id,
          subject: row.subject,
        })),
      },
      null,
      2,
    ),
  );

  if (!live) {
    console.log("\nDry run only. Re-run with --live to delete.");
    return;
  }

  const conversationIds = preview.map((row) => row.id);
  if (conversationIds.length === 0) {
    console.log("Nothing to delete.");
    return;
  }

  await ccPrisma.$transaction(async (db) => {
    await db.$executeRaw`SELECT set_config('app.is_staff', 'true', true)`;
    await db.$executeRaw`SELECT set_config('app.organization_id', ${ORG_ID}, true)`;

    const deletedInteractions = await db.$executeRaw`
      DELETE FROM cdp.interactions
      WHERE organization_id = ${ORG_ID}::bigint
        AND conversation_id = ANY(${conversationIds}::bigint[])
    `;

    const deletedConversations = await db.$executeRaw`
      DELETE FROM ccass.conversations
      WHERE organization_id = ${ORG_ID}::bigint
        AND id = ANY(${conversationIds}::bigint[])
    `;

    await db.$executeRaw`
      UPDATE ccass.agent_capacity ac
      SET active_count = 0,
          reserved_count = 0,
          updated_at = NOW()
      FROM ccass.agents a
      WHERE ac.agent_id = a.id
        AND a.organization_id = ${ORG_ID}::bigint
        AND ac.channel = 'email'
    `;

    console.log(
      JSON.stringify(
        {
          deletedConversations,
          deletedInteractions,
        },
        null,
        2,
      ),
    );
  });
}

main()
  .catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  })
  .finally(async () => {
    await ccPrisma.$disconnect();
  });
