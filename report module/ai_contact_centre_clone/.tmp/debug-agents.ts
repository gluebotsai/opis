import "@ai-contact-center/config/load-root-env";
import { ccPrisma } from "@ai-contact-center/db-cc";

async function main() {
  await ccPrisma.$executeRaw`SELECT set_config('app.is_staff', 'true', true)`;
  const rows = await ccPrisma.$queryRaw`
    SELECT a.id::text, u.work_email, p.state, p.updated_at,
      qm.queue_id::text, qm.whatsapp_concurrency, qm.handles_whatsapp,
      ac.channel, ac.active_count, ac.reserved_count
    FROM ccass.agents a
    JOIN accounts.setup_users u ON u.id = a.setup_user_id
    LEFT JOIN ccass.agent_presence p ON p.agent_id = a.id
    LEFT JOIN ccass.queue_members qm ON qm.agent_id = a.id
    LEFT JOIN ccass.agent_capacity ac ON ac.agent_id = a.id
    WHERE a.organization_id = 1000::bigint
    ORDER BY u.work_email, ac.channel
  `;
  console.log(JSON.stringify(rows, null, 2));
}

main().finally(() => ccPrisma.$disconnect());
