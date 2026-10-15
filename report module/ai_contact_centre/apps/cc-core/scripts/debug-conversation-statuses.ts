import "@ai-contact-center/config/load-root-env";
import { ccPrisma } from "@ai-contact-center/db-cc";

async function main() {
  await ccPrisma.$executeRawUnsafe(`SELECT set_config('app.is_staff', 'true', true)`);

  const orgs = await ccPrisma.organizations.findMany({
    where: { lifecycle_status: "active" },
    orderBy: { created_at: "desc" },
    select: { id: true, company_name: true, created_at: true },
  });
  console.log("Active organizations:");
  console.log(JSON.stringify(orgs, null, 2));

  for (const org of orgs) {
    const webchatConfigs = await ccPrisma.$queryRawUnsafe(`
      SELECT config.*, channel.status as channel_status, channel.organization_id
      FROM accounts.setup_webchat_configs config
      INNER JOIN accounts.setup_channel_configs channel ON channel.id = config.channel_config_id
      WHERE channel.organization_id = $1::bigint
    `, org.id);
    console.log(`\nWebchat configs for ${org.company_name} (${org.id}):`);
    console.log(JSON.stringify(webchatConfigs, null, 2));

    const whatsappConfigs = await ccPrisma.$queryRawUnsafe(`
      SELECT channel.*
      FROM accounts.setup_channel_configs channel
      WHERE channel.organization_id = $1::bigint AND channel.channel_type = 'whatsapp'
    `, org.id);
    console.log(`WhatsApp configs for ${org.company_name} (${org.id}):`);
    console.log(JSON.stringify(whatsappConfigs, null, 2));
  }
}

main().catch(console.error);
