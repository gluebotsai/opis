/**
 * Merge duplicate open email sessions for the same customer (per mailbox).
 * Keeps the most recently updated conversation and moves messages into it.
 *
 * Usage:
 *   npx tsx scripts/dedupe-open-email-sessions.ts
 *   npx tsx scripts/dedupe-open-email-sessions.ts --live
 *   ORGANIZATION_ID=<uuid> npx tsx scripts/dedupe-open-email-sessions.ts --live
 */
import "@ai-contact-center/config/load-root-env";
import { ccPrisma } from "@ai-contact-center/db-cc";

const ORG_ID = process.env.ORGANIZATION_ID;
const live = process.argv.includes("--live");

type DuplicateGroup = {
  visitor_id: string;
  mailbox_connection_id: string | null;
  conversation_ids: string[];
  keeper_id: string;
};

async function listDuplicateGroups(organizationId: string): Promise<DuplicateGroup[]> {
  await ccPrisma.$executeRaw`SELECT set_config('app.is_staff', 'true', true)`;
  await ccPrisma.$executeRaw`SELECT set_config('app.organization_id', ${organizationId}, true)`;

  return ccPrisma.$queryRaw<DuplicateGroup[]>`
    WITH open_email AS (
      SELECT
        id,
        lower(visitor_id) AS visitor_key,
        visitor_id,
        mailbox_connection_id,
        updated_at
      FROM ccass.conversations
      WHERE organization_id = ${organizationId}::bigint
        AND channel = 'email'
        AND visitor_id IS NOT NULL
        AND status NOT IN ('resolved', 'closed')
    ),
    grouped AS (
      SELECT
        visitor_id,
        mailbox_connection_id,
        array_agg(id ORDER BY updated_at DESC) AS conversation_ids
      FROM open_email
      GROUP BY visitor_key, mailbox_connection_id, visitor_id
      HAVING COUNT(*) > 1
    )
    SELECT
      visitor_id,
      mailbox_connection_id,
      conversation_ids,
      conversation_ids[1] AS keeper_id
    FROM grouped
    ORDER BY visitor_id
  `;
}

async function mergeDuplicateGroups(organizationId: string, groups: DuplicateGroup[]) {
  let mergedMessages = 0;
  let removedConversations = 0;

  for (const group of groups) {
    const duplicateIds = group.conversation_ids.filter((id) => id !== group.keeper_id);
    if (duplicateIds.length === 0) continue;

    const moved = await ccPrisma.$executeRaw`
      UPDATE ccass.conversation_messages
      SET conversation_id = ${group.keeper_id}::bigint
      WHERE organization_id = ${organizationId}::bigint
        AND conversation_id = ANY(${duplicateIds}::bigint[])
    `;
    mergedMessages += Number(moved);

    await ccPrisma.$executeRaw`
      DELETE FROM cdp.interactions
      WHERE organization_id = ${organizationId}::bigint
        AND conversation_id = ANY(${duplicateIds}::bigint[])
    `;

    const removed = await ccPrisma.$executeRaw`
      DELETE FROM ccass.conversations
      WHERE organization_id = ${organizationId}::bigint
        AND id = ANY(${duplicateIds}::bigint[])
    `;
    removedConversations += Number(removed);

    await ccPrisma.$executeRaw`
      UPDATE ccass.conversations
      SET updated_at = NOW()
      WHERE id = ${group.keeper_id}::bigint
        AND organization_id = ${organizationId}::bigint
    `;
  }

  return { mergedMessages, removedConversations };
}

async function main() {
  await ccPrisma.$executeRaw`SELECT set_config('app.is_staff', 'true', true)`;

  const organizationIds = ORG_ID
    ? [ORG_ID]
    : (
        await ccPrisma.$queryRaw<Array<{ organization_id: string }>>`
          SELECT DISTINCT organization_id
          FROM ccass.conversations
          WHERE channel = 'email'
            AND visitor_id IS NOT NULL
            AND status NOT IN ('resolved', 'closed')
        `
      ).map((row) => row.organization_id);

  const report: Array<{
    organizationId: string;
    visitorId: string;
    mailboxConnectionId: string | null;
    keeperId: string;
    duplicateCount: number;
    conversationIds: string[];
  }> = [];

  for (const organizationId of organizationIds) {
    const groups = await listDuplicateGroups(organizationId);
    for (const group of groups) {
      report.push({
        organizationId,
        visitorId: group.visitor_id,
        mailboxConnectionId: group.mailbox_connection_id,
        keeperId: group.keeper_id,
        duplicateCount: group.conversation_ids.length - 1,
        conversationIds: group.conversation_ids,
      });
    }
  }

  console.log(
    JSON.stringify(
      {
        live,
        organizationsProcessed: organizationIds.length,
        duplicateSenderGroups: report.length,
        groups: report,
      },
      null,
      2,
    ),
  );

  if (!live) {
    console.log("\nDry run only. Re-run with --live to merge duplicates.");
    return;
  }

  if (report.length === 0) {
    console.log("No duplicate open email sessions found.");
    return;
  }

  let mergedMessages = 0;
  let removedConversations = 0;
  for (const organizationId of organizationIds) {
    const groups = await listDuplicateGroups(organizationId);
    if (groups.length === 0) continue;
    const result = await mergeDuplicateGroups(organizationId, groups);
    mergedMessages += result.mergedMessages;
    removedConversations += result.removedConversations;
  }

  console.log(JSON.stringify({ mergedMessages, removedConversations }, null, 2));
}

main()
  .catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  })
  .finally(async () => {
    await ccPrisma.$disconnect();
  });
