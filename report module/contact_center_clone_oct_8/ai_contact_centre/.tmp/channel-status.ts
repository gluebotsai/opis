/**
 * Channel readiness snapshot for org 1000.
 */
import "@ai-contact-center/config/load-root-env";
import { ccPrisma } from "@ai-contact-center/db-cc";

const ORG_ID = process.env.ORGANIZATION_ID ?? "1000";

async function main() {
  await ccPrisma.$executeRaw`SELECT set_config('app.is_staff', 'true', true)`;

  const webchats = await ccPrisma.$queryRaw<
    Array<{ webchat_id: string; routing_queue_id: string | null; title: string | null }>
  >`
    SELECT wc.webchat_id, wc.routing_queue_id, wc.title
    FROM accounts.setup_webchat_configs wc
    JOIN accounts.setup_channel_configs cc ON cc.id = wc.channel_config_id
    WHERE cc.organization_id = ${ORG_ID}::bigint AND cc.status = 'active'
  `;

  const social = await ccPrisma.$queryRaw<
    Array<{ provider: string; channel_config_id: string; bot_enabled: boolean | null }>
  >`
    SELECT sc.provider, sc.channel_config_id, sc.bot_enabled
    FROM accounts.setup_social_configs sc
    JOIN accounts.setup_channel_configs cc ON cc.id = sc.channel_config_id
    WHERE cc.organization_id = ${ORG_ID}::bigint AND cc.status = 'active'
  `;

  const email = await ccPrisma.$queryRaw<
    Array<{ channel_config_id: string; sender_email: string | null }>
  >`
    SELECT ec.channel_config_id, ec.sender_email
    FROM accounts.setup_email_configs ec
    JOIN accounts.setup_channel_configs cc ON cc.id = ec.channel_config_id
    WHERE cc.organization_id = ${ORG_ID}::bigint AND cc.status = 'active'
  `;

  const policies = await ccPrisma.$queryRaw<
    Array<{ channel: string; live_agent_enabled: boolean; default_queue_id: string | null }>
  >`
    SELECT channel, live_agent_enabled, default_queue_id
    FROM ccass.channel_automation_policies
    WHERE organization_id = ${ORG_ID}::bigint AND status = 'active'
  `;

  const queueMembers = await ccPrisma.$queryRaw<
    Array<{
      handles_chat: boolean;
      handles_email: boolean;
      handles_whatsapp: boolean;
      handles_instagram: boolean;
      handles_facebook: boolean;
      ready: boolean;
    }>
  >`
    SELECT
      qm.handles_chat,
      qm.handles_email,
      qm.handles_whatsapp,
      qm.handles_instagram,
      qm.handles_facebook,
      COALESCE(ap.presence_state = 'ready', FALSE) AS ready
    FROM ccass.queue_members qm
    JOIN ccass.queues q ON q.id = qm.queue_id
    LEFT JOIN ccass.agent_presence ap ON ap.agent_id = qm.agent_id
    WHERE q.organization_id = ${ORG_ID}::bigint
  `;

  console.log(
    JSON.stringify(
      { organizationId: ORG_ID, webchats, social, email, policies, queueMembers },
      (_, v) => (typeof v === "bigint" ? String(v) : v),
      2,
    ),
  );
}

main()
  .catch(console.error)
  .finally(() => ccPrisma.$disconnect());
