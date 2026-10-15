import "@ai-contact-center/config/load-root-env";
import { ccPrisma } from "@ai-contact-center/db-cc";

async function main() {
  await ccPrisma.$executeRawUnsafe(`SELECT set_config('app.is_staff', 'true', true)`);

  const ORG_ID = "ce4ff326-4c0e-43f2-a978-e6b494cd0775";
  const QUEUE_ID = "81019f3d-826b-498f-8273-18abe4df6dba"; // pre sales

  // Update setup_webchat_configs to use the queue
  const updatedWebchats = await ccPrisma.$executeRawUnsafe(`
    UPDATE accounts.setup_webchat_configs config
    SET routing_queue_id = $1::bigint
    FROM accounts.setup_channel_configs channel
    WHERE channel.id = config.channel_config_id
      AND channel.organization_id = $2::bigint
  `, QUEUE_ID, ORG_ID);
  console.log(`Updated ${updatedWebchats} setup_webchat_configs to use routing queue.`);

  // Let's verify setup_webchat_configs
  const webchats = await ccPrisma.$queryRawUnsafe(`
    SELECT config.webchat_id, config.routing_queue_id, channel.status
    FROM accounts.setup_webchat_configs config
    INNER JOIN accounts.setup_channel_configs channel ON channel.id = config.channel_config_id
    WHERE channel.organization_id = $1::bigint
  `, ORG_ID);
  console.log("Current webchat configs:", JSON.stringify(webchats, null, 2));
}

main().catch(console.error);
