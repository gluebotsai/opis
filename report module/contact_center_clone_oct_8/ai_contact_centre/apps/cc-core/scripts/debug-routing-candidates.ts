/**
 * Debug webchat routing candidates for org 1000 Support queue.
 */
import "@ai-contact-center/config/load-root-env";
import { ccPrisma } from "@ai-contact-center/db-cc";

const ORG_ID = process.env.ORGANIZATION_ID ?? "1000";
const QUEUE_ID = process.env.QUEUE_ID ?? "1000";

async function main() {
  await ccPrisma.$executeRaw`SELECT set_config('app.is_staff', 'true', true)`;
  await ccPrisma.$executeRaw`SELECT set_config('app.organization_id', ${ORG_ID}, true)`;

  await ccPrisma.$executeRaw`
    UPDATE ccass.agent_presence
    SET
      status = 'ready',
      presence_state = 'ready',
      heartbeat_at = NOW(),
      lease_expires_at = NOW() + INTERVAL '90 seconds',
      source = 'debug_routing',
      updated_at = NOW()
    WHERE organization_id = ${ORG_ID}::bigint
      AND agent_id IN (
        SELECT agent_id FROM ccass.queue_members WHERE queue_id = ${QUEUE_ID}::bigint
      )
  `;

  const members = await ccPrisma.$queryRaw`
    SELECT qm.agent_id, qm.setup_user_id, qm.handles_chat, qm.chat_concurrency,
           u.work_email,
           ac.active_count, ac.reserved_count, ac.max_concurrency,
           ap.presence_state, ap.status
    FROM ccass.queue_members qm
    JOIN accounts.setup_users u ON u.id = qm.setup_user_id
    LEFT JOIN ccass.agent_capacity ac ON ac.agent_id = qm.agent_id AND ac.channel = 'chat'
    LEFT JOIN ccass.agent_presence ap ON ap.agent_id = qm.agent_id
    WHERE qm.queue_id = ${QUEUE_ID}::bigint
  `;

  const queue = await ccPrisma.$queryRaw`
    SELECT id, name, status, published_at FROM ccass.queues
    WHERE id = ${QUEUE_ID}::bigint AND organization_id = ${ORG_ID}::bigint
  `;

  console.log(
    JSON.stringify({ organizationId: ORG_ID, queueId: QUEUE_ID, queue, members }, (_, value) =>
      typeof value === "bigint" ? value.toString() : value,
    2),
  );
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await ccPrisma.$disconnect();
  });
