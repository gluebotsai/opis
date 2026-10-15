import "@ai-contact-center/config/load-root-env";
import { ccPrisma } from "@ai-contact-center/db-cc";
import { CcCoreClient, loadE2eConfig } from "@ai-contact-center/test-harness";

async function main() {
  const cc = new CcCoreClient(loadE2eConfig());
  const session = await cc.loginAgent("agent.test@worktual.local", "Worktual@123");
  console.log("session", session);
  await ccPrisma.$executeRaw`SELECT set_config('app.is_staff', 'true', true)`;
  const rows = await ccPrisma.$queryRaw`
    SELECT a.id::text AS agent_id, a.setup_user_id::text, u.work_email
    FROM ccass.agents a
    JOIN accounts.setup_users u ON u.id = a.setup_user_id
    WHERE u.work_email = 'agent.test@worktual.local'
  `;
  console.log("agent row", rows);
}

main().finally(() => ccPrisma.$disconnect());
