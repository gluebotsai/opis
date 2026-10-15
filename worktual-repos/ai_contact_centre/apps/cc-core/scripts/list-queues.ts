import "@ai-contact-center/config/load-root-env";
import { ccPrisma } from "@ai-contact-center/db-cc";

async function main() {
  await ccPrisma.$executeRawUnsafe(`SELECT set_config('app.is_staff', 'true', true)`);

  const ORG_ID = "ce4ff326-4c0e-43f2-a978-e6b494cd0775";

  const queues = await ccPrisma.$queryRawUnsafe(`
    SELECT id, name, team_id, status
    FROM accounts.setup_ccaas_queues
    WHERE organization_id = $1::bigint
  `, ORG_ID);
  console.log("Setup queues (accounts schema):", JSON.stringify(queues, null, 2));

  const routingQueues = await ccPrisma.$queryRawUnsafe(`
    SELECT id, name, organization_id, status
    FROM ccass.queues
    WHERE organization_id = $1::bigint
  `, ORG_ID);
  console.log("Routing queues (ccass schema):", JSON.stringify(routingQueues, null, 2));
}

main().catch(console.error);
