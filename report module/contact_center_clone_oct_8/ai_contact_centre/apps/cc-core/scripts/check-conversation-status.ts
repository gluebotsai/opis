import "@ai-contact-center/config/load-root-env";
import { ccPrisma } from "@ai-contact-center/db-cc";

const ORG = "ce4ff326-4c0e-43f2-a978-e6b494cd0775";
const CONV = process.argv[2] ?? "1174ed3f-0861-4076-82fc-f01478055703";

async function main() {
  await ccPrisma.$executeRaw`SELECT set_config('app.is_staff', 'true', true)`;
  await ccPrisma.$executeRaw`SELECT set_config('app.organization_id', ${ORG}, true)`;

  const conv = await ccPrisma.$queryRaw`
    SELECT c.id, c.status, c.subject, c.priority, c.queued_at, c.assigned_at,
           c.assigned_agent_id, c.assigned_user_id, c.queue_id, c.handoff_reason, c.bot_active,
           q.name AS queue_name,
           u.work_email AS agent_email
    FROM ccass.conversations c
    LEFT JOIN ccass.queues q ON q.id = c.queue_id
    LEFT JOIN ccass.agents a ON a.id = c.assigned_agent_id
    LEFT JOIN accounts.setup_users u ON u.id = COALESCE(c.assigned_user_id, a.setup_user_id)
    WHERE c.id = ${CONV}::bigint
  `;

  const msgs = await ccPrisma.$queryRaw`
    SELECT direction, left(body, 80) AS body, created_at
    FROM ccass.conversation_messages
    WHERE conversation_id = ${CONV}::bigint
    ORDER BY created_at DESC LIMIT 5
  `;

  const routing = await ccPrisma.$queryRaw`
    SELECT *
    FROM ccass.routing_attempts
    WHERE conversation_id = ${CONV}::bigint
    ORDER BY created_at DESC LIMIT 10
  `;

  const agents = await ccPrisma.$queryRaw`
    SELECT u.work_email, ap.presence_state, ap.status,
           ac.active_count, ac.max_concurrency, ac.reserved_count
    FROM ccass.agents a
    JOIN accounts.setup_users u ON u.id = a.setup_user_id
    LEFT JOIN ccass.agent_presence ap ON ap.agent_id = a.id
    LEFT JOIN ccass.agent_capacity ac ON ac.agent_id = a.id AND ac.channel = 'email'
    WHERE u.organization_id = ${ORG}::bigint
    ORDER BY u.work_email
  `;

  console.log(JSON.stringify({ conv, msgs, routing, agents }, null, 2));
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => ccPrisma.$disconnect());
