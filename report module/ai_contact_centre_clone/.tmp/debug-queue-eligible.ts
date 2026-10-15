import "@ai-contact-center/config/load-root-env";
import { ccPrisma } from "@ai-contact-center/db-cc";

async function main() {
  await ccPrisma.$executeRaw`SELECT set_config('app.is_staff', 'true', true)`;
  const ORG = "1000";

  const users = await ccPrisma.$queryRaw`
    SELECT u.id::text, u.work_email, u.first_name, u.last_name, u.status, u.team_id::text, u.shift_types,
      qa.queue_id::text, qa.shift_type, qa.handles_whatsapp
    FROM accounts.setup_users u
    LEFT JOIN accounts.setup_ccaas_queue_agents qa ON qa.user_id = u.id
    LEFT JOIN accounts.setup_ccaas_queues q ON q.id = qa.queue_id
    WHERE u.organization_id = ${ORG}::bigint
      AND lower(u.work_email) IN (
        'agent.test@worktual.local','agent2.test@worktual.local',
        'bhrthsivakumar@gmail.com','spm.sidharth@gmail.com','yaswanthmg1@gmail.com'
      )
    ORDER BY u.work_email
  `;

  const queue = await ccPrisma.$queryRaw`
    SELECT id::text, name, team_id::text, shift_types FROM accounts.setup_ccaas_queues
    WHERE organization_id = ${ORG}::bigint AND id = 1001::bigint
  `;

  const allAgents = await ccPrisma.$queryRaw`
    SELECT u.id::text, u.work_email, u.team_id::text, u.shift_types, u.status,
      EXISTS (
        SELECT 1 FROM accounts.setup_ccaas_queue_agents qa2
        JOIN accounts.setup_ccaas_queues q2 ON q2.id = qa2.queue_id
        WHERE qa2.user_id = u.id AND q2.organization_id = ${ORG}::bigint AND qa2.queue_id <> 1001::bigint
      ) AS on_other_queue
    FROM accounts.setup_users u
    WHERE u.organization_id = ${ORG}::bigint
      AND EXISTS (
        SELECT 1 FROM accounts.setup_user_product_access pa
        JOIN accounts.setup_roles r ON r.id = pa.role_id
        WHERE pa.user_id = u.id AND lower(r.name) = 'agent'
      )
    ORDER BY u.work_email
  `;

  console.log(JSON.stringify({ queue, users, allAgents }, null, 2));
}

main().catch(console.error).finally(() => ccPrisma.$disconnect());
