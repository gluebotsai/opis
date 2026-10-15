import "@ai-contact-center/config/load-root-env";
import { ccPrisma } from "@ai-contact-center/db-cc";

const ORG = process.env.ORGANIZATION_ID ?? "ce4ff326-4c0e-43f2-a978-e6b494cd0775";

async function main() {
  await ccPrisma.$executeRaw`SELECT set_config('app.is_staff', 'true', true)`;
  await ccPrisma.$executeRaw`SELECT set_config('app.organization_id', ${ORG}, true)`;

  const queuedEmails = await ccPrisma.$queryRaw`
    SELECT c.id, c.subject, c.status, c.queue_id, c.priority, c.queued_at, c.updated_at,
           q.name AS queue_name
    FROM ccass.conversations c
    LEFT JOIN ccass.queues q ON q.id = c.queue_id
    WHERE c.organization_id = ${ORG}::bigint
      AND c.channel = 'email'
      AND c.status = 'queued'
      AND c.assigned_agent_id IS NULL
    ORDER BY c.priority DESC, c.queued_at ASC NULLS LAST
    LIMIT 20
  `;

  const agents = await ccPrisma.$queryRaw`
    SELECT
      a.id AS agent_id,
      u.work_email,
      ap.presence_state,
      ap.status AS presence_status,
      ap.heartbeat_at,
      ap.lease_expires_at,
      qm.queue_id,
      q.name AS queue_name,
      qm.handles_email,
      qm.email_concurrency,
      ac.active_count AS email_active,
      ac.reserved_count AS email_reserved,
      ac.max_concurrency AS email_max
    FROM ccass.agents a
    JOIN accounts.setup_users u ON u.id = a.setup_user_id
    LEFT JOIN ccass.agent_presence ap ON ap.agent_id = a.id
    LEFT JOIN ccass.queue_members qm ON qm.agent_id = a.id
    LEFT JOIN ccass.queues q ON q.id = qm.queue_id
    LEFT JOIN ccass.agent_capacity ac
      ON ac.agent_id = a.id AND ac.channel = 'email'
    WHERE u.organization_id = ${ORG}::bigint
    ORDER BY u.work_email, q.name
  `;

  const recentHandoffs = await ccPrisma.$queryRaw`
    SELECT c.id, c.subject, c.status, c.assigned_agent_id, u.work_email AS assigned_email,
           c.updated_at, q.name AS queue_name
    FROM ccass.conversations c
    LEFT JOIN ccass.agents a ON a.id = c.assigned_agent_id
    LEFT JOIN accounts.setup_users u ON u.id = a.setup_user_id
    LEFT JOIN ccass.queues q ON q.id = c.queue_id
    WHERE c.organization_id = ${ORG}::bigint
      AND c.channel = 'email'
      AND c.updated_at > NOW() - INTERVAL '24 hours'
    ORDER BY c.updated_at DESC
    LIMIT 15
  `;

  console.log(
    JSON.stringify(
      {
        organizationId: ORG,
        queuedEmailCount: Array.isArray(queuedEmails) ? queuedEmails.length : 0,
        queuedEmails,
        agents,
        recentEmailConversations: recentHandoffs,
      },
      (_key, value) => (typeof value === "bigint" ? Number(value) : value),
      2,
    ),
  );
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => ccPrisma.$disconnect());
