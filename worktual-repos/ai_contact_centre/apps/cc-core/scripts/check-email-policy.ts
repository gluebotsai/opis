import "@ai-contact-center/config/load-root-env";
import { ccPrisma } from "@ai-contact-center/db-cc";
import {
  resolveEmailHandoffQueueId,
  resolveEmailMailboxPolicy,
} from "../src/services/email-policies.js";

const ORG = "ce4ff326-4c0e-43f2-a978-e6b494cd0775";
const args = process.argv.slice(2).filter((arg) => arg !== "--fix");
const FIX = process.argv.includes("--fix");
const CONV = args[0] ?? "5ebe797c-3367-462c-9c5a-5695065eb4a9";

async function main() {
  await ccPrisma.$executeRaw`SELECT set_config('app.is_staff', 'true', true)`;
  await ccPrisma.$executeRaw`SELECT set_config('app.organization_id', ${ORG}, true)`;

  const conv = await ccPrisma.$queryRaw<
    Array<{ queue_id: string | null; mailbox_connection_id: string | null; visitor_id: string | null }>
  >`
    SELECT queue_id, mailbox_connection_id, visitor_id
    FROM ccass.conversations
    WHERE id = ${CONV}::bigint
  `;
  const row = conv[0];
  if (!row) {
    console.log("conversation not found");
    return;
  }

  const policy = await resolveEmailMailboxPolicy(ccPrisma, ORG, {
    connectionId: row.mailbox_connection_id,
    accountEmail: row.visitor_id ?? "",
  });

  if (FIX && policy?.defaultQueueId && row.mailbox_connection_id) {
    const allowed = new Set(policy.allowedQueueIds);
    allowed.add(policy.defaultQueueId);
    await ccPrisma.$executeRaw`
      UPDATE ccass.email_mailbox_policies
      SET allowed_queue_ids = ${JSON.stringify([...allowed])}::jsonb,
          updated_at = NOW()
      WHERE organization_id = ${ORG}::bigint
        AND connection_id = ${row.mailbox_connection_id}::bigint
        AND status = 'active'
    `;
    console.log("updated allowed_queue_ids to include defaultQueueId:", policy.defaultQueueId);
  }

  const updatedPolicy = await resolveEmailMailboxPolicy(ccPrisma, ORG, {
    connectionId: row.mailbox_connection_id,
    accountEmail: row.visitor_id ?? "",
  });
  const resolved = await resolveEmailHandoffQueueId(ccPrisma, ORG, {
    mailboxConnectionId: row.mailbox_connection_id,
    preferredQueueId: row.queue_id,
    allowedQueueIds: updatedPolicy?.allowedQueueIds ?? [],
    defaultQueueId: updatedPolicy?.defaultQueueId ?? null,
  });

  const queues = await ccPrisma.$queryRaw`
    SELECT q.id, q.name, q.status,
      EXISTS(SELECT 1 FROM ccass.queue_members m WHERE m.queue_id = q.id AND m.handles_email = TRUE) as has_email
    FROM ccass.queues q
    WHERE q.organization_id = ${ORG}::bigint
  `;

  console.log(
    JSON.stringify(
      {
        conversation: row,
        policy: updatedPolicy,
        resolvedQueueId: resolved,
        queues,
      },
      null,
      2,
    ),
  );
}

main().finally(() => ccPrisma.$disconnect());
