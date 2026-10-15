import "@ai-contact-center/config/load-root-env";
import { ccPrisma } from "@ai-contact-center/db-cc";

async function main() {
  const conversationId = process.argv[2] ?? "1031";
  await ccPrisma.$executeRaw`SELECT set_config('app.is_staff', 'true', true)`;
  const rows = await ccPrisma.$queryRaw`
    SELECT c.status, c.assigned_agent_id::text, a.id::text AS agent_for_user_1003,
      ca.state, ca.id::text AS assignment_id
    FROM ccass.conversations c
    CROSS JOIN ccass.agents a
    LEFT JOIN ccass.conversation_assignments ca ON ca.conversation_id = c.id AND ca.agent_id = a.id
    WHERE c.id = ${conversationId}::bigint
      AND a.setup_user_id = 1003::bigint
  `;
  console.log(rows);
}

main().finally(() => ccPrisma.$disconnect());
