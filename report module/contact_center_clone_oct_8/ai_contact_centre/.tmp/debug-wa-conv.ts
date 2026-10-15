import "@ai-contact-center/config/load-root-env";
import { ccPrisma } from "@ai-contact-center/db-cc";

async function main() {
  await ccPrisma.$executeRaw`SELECT set_config('app.is_staff', 'true', true)`;
  const rows = await ccPrisma.$queryRaw`
    SELECT c.id::text, c.status, c.assigned_agent_id::text, ca.state, ca.agent_id::text, u.work_email
    FROM ccass.conversations c
    LEFT JOIN ccass.conversation_assignments ca ON ca.conversation_id = c.id
    LEFT JOIN ccass.agents a ON a.id = ca.agent_id
    LEFT JOIN accounts.setup_users u ON u.id = a.setup_user_id
    WHERE c.channel = 'whatsapp'
    ORDER BY c.created_at DESC
    LIMIT 3
  `;
  console.log(JSON.stringify(rows, null, 2));
}

main()
  .finally(() => ccPrisma.$disconnect());
