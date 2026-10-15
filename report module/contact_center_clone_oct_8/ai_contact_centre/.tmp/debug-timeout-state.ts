import "@ai-contact-center/config/load-root-env";
import { ccPrisma } from "@ai-contact-center/db-cc";

async function main() {
  await ccPrisma.$executeRaw`SELECT set_config('app.is_staff', 'true', true)`;
  await ccPrisma.$executeRaw`SELECT set_config('app.organization_id', '1000', true)`;

  const convs = await ccPrisma.$queryRaw`
    SELECT c.id::text, c.status, c.lifecycle_state, c.bot_active, c.queue_id::text,
           c.assigned_agent_id::text, c.handoff_reason, c.updated_at, c.visitor_id
    FROM ccass.conversations c
    WHERE c.organization_id = 1000 AND c.channel = 'webchat'
      AND c.webchat_id = 'wc_f7b08f360dbd410aa77007a9fd209244'
    ORDER BY c.updated_at DESC
    LIMIT 5
  `;

  const convId = (convs as Array<{ id: string }>)[0]?.id;
  const assignments = convId
    ? await ccPrisma.$queryRaw`
        SELECT id::text, agent_id::text, state, reason, offered_at, expired_at, rejected_at,
               accepted_at, expires_at
        FROM ccass.conversation_assignments
        WHERE organization_id = 1000 AND conversation_id = ${convId}::bigint
        ORDER BY offered_at DESC NULLS LAST
      `
    : [];

  const messages = convId
    ? await ccPrisma.$queryRaw`
        SELECT sender_type, left(body, 120) AS body, created_at
        FROM ccass.conversation_messages
        WHERE organization_id = 1000 AND conversation_id = ${convId}::bigint
        ORDER BY created_at DESC
        LIMIT 12
      `
    : [];

  const policies = await ccPrisma.$queryRaw`
    SELECT queue_id::text, offer_timeout_seconds, max_attempts, overflow_queue_id::text
    FROM ccass.routing_policies
    WHERE organization_id = 1000
  `;

  const presence = await ccPrisma.$queryRaw`
    SELECT a.id::text AS agent_id, u.work_email, p.presence_state, p.status, p.lease_expires_at, p.heartbeat_at
    FROM ccass.agents a
    JOIN accounts.setup_users u ON u.id = a.setup_user_id
    LEFT JOIN ccass.agent_presence p ON p.agent_id = a.id
    WHERE a.organization_id = 1000
    ORDER BY a.id
  `;

  const cap = await ccPrisma.$queryRaw`
    SELECT a.id::text, u.work_email, ac.channel, ac.active_count, ac.reserved_count, ac.max_concurrency
    FROM ccass.agent_capacity ac
    JOIN ccass.agents a ON a.id = ac.agent_id
    JOIN accounts.setup_users u ON u.id = a.setup_user_id
    WHERE a.organization_id = 1000 AND ac.channel = 'chat'
  `;

  console.log(JSON.stringify({ convs, assignments, messages, policies, presence, cap }, null, 2));
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await ccPrisma.$disconnect();
  });
