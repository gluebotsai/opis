import "@ai-contact-center/config/load-root-env";
import { ccPrisma } from "@ai-contact-center/db-cc";

async function main() {
  await ccPrisma.$executeRaw`SELECT set_config('app.is_staff', 'true', true)`;
  const ORG = process.env.ORGANIZATION_ID ?? "1000";

  const waQueues = await ccPrisma.$queryRaw`
    SELECT q.id::text, q.name, q.status, q.published_at,
      EXISTS (
        SELECT 1 FROM ccass.queue_members qm
        WHERE qm.queue_id = q.id AND qm.handles_whatsapp = TRUE
      ) AS has_wa_members
    FROM ccass.queues q
    WHERE q.organization_id = ${ORG}::bigint
    ORDER BY q.id
  `;

  const members = await ccPrisma.$queryRaw`
    SELECT q.id::text AS queue_id, q.name AS queue_name,
      u.work_email, qm.handles_whatsapp, qm.whatsapp_concurrency,
      ap.presence_state, ap.status, ap.heartbeat_at, ap.lease_expires_at,
      ac.active_count, ac.reserved_count, ac.max_concurrency
    FROM ccass.queue_members qm
    JOIN ccass.queues q ON q.id = qm.queue_id
    JOIN ccass.agents a ON a.id = qm.agent_id
    JOIN accounts.setup_users u ON u.id = qm.setup_user_id
    LEFT JOIN ccass.agent_presence ap ON ap.agent_id = qm.agent_id
    LEFT JOIN ccass.agent_capacity ac ON ac.agent_id = qm.agent_id AND ac.channel = 'whatsapp'
    WHERE q.organization_id = ${ORG}::bigint
    ORDER BY q.name, u.work_email
  `;

  const waPolicy = await ccPrisma.$queryRaw`
    SELECT channel_config_id::text, default_queue_id::text, bot_enabled, live_agent_enabled, status
    FROM ccass.whatsapp_channel_policies
    WHERE organization_id = ${ORG}::bigint
  `;

  const setupMembers = await ccPrisma.$queryRaw`
    SELECT q.name AS queue_name, u.work_email,
      qa.handles_whatsapp, qa.whatsapp_concurrency
    FROM accounts.setup_ccaas_queue_agents qa
    JOIN accounts.setup_ccaas_queues q ON q.id = qa.queue_id
    JOIN accounts.setup_users u ON u.id = qa.user_id
    WHERE q.organization_id = ${ORG}::bigint
    ORDER BY q.name, u.work_email
  `;

  const recentWa = await ccPrisma.$queryRaw`
    SELECT id::text, status, queue_id::text, bot_active, handoff_reason, created_at
    FROM ccass.conversations
    WHERE organization_id = ${ORG}::bigint AND channel = 'whatsapp'
    ORDER BY created_at DESC
    LIMIT 3
  `;

  console.log(
    JSON.stringify({ organizationId: ORG, waQueues, members, setupMembers, waPolicy, recentWa }, (_, v) =>
      typeof v === "bigint" ? String(v) : v,
    2),
  );
}

main()
  .catch(console.error)
  .finally(() => ccPrisma.$disconnect());
