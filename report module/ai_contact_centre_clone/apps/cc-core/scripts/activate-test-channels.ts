import "@ai-contact-center/config/load-root-env";
import { ccPrisma } from "@ai-contact-center/db-cc";

async function main() {
  await ccPrisma.$executeRawUnsafe(`SELECT set_config('app.is_staff', 'true', true)`);

  const ORG_ID = "ce4ff326-4c0e-43f2-a978-e6b494cd0775";

  // Activate all channel configs for this org
  const updatedChannels = await ccPrisma.$executeRawUnsafe(`
    UPDATE accounts.setup_channel_configs
    SET status = 'active'
    WHERE organization_id = $1::bigint
  `, ORG_ID);

  console.log(`Updated ${updatedChannels} channel configs to active.`);

  // Let's verify
  const channels = await ccPrisma.$queryRawUnsafe(`
    SELECT id, channel_type, status
    FROM accounts.setup_channel_configs
    WHERE organization_id = $1::bigint
  `, ORG_ID);
  console.log("Current channel configs:", JSON.stringify(channels, null, 2));
}

main().catch(console.error);
