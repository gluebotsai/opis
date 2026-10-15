import "@ai-contact-center/config/load-root-env";
import { ccPrisma } from "@ai-contact-center/db-cc";

async function main() {
  await ccPrisma.$executeRaw`SELECT set_config('app.is_staff', 'true', true)`;
  await ccPrisma.$executeRaw`SELECT set_config('app.organization_id', '1000', true)`;

  const widgets = await ccPrisma.$queryRaw`
    SELECT wc.webchat_id, wc.channel_config_id::text, wc.routing_queue_id::text AS setup_queue_id, wc.title,
           rq.id::text AS ccass_queue_id, rq.name AS ccass_name, sq.name AS setup_name
    FROM accounts.setup_webchat_configs wc
    LEFT JOIN accounts.setup_ccaas_queues sq ON sq.id = wc.routing_queue_id
    LEFT JOIN ccass.queues rq ON rq.setup_queue_id = sq.id
    WHERE wc.webchat_id IN (
      'wc_5d80cd9b1ace4080bc70717552472611',
      'wc_f7b08f360dbd410aa77007a9fd209244'
    )
  `;
  const policies = await ccPrisma.$queryRaw`
    SELECT p.id::text, p.channel_config_id::text, p.channel, p.default_queue_id::text,
           p.allowed_queue_ids::text, p.live_agent_enabled, p.bot_enabled, p.status
    FROM ccass.channel_automation_policies p
    WHERE p.organization_id = 1000 AND p.channel = 'webchat'
  `;
  const queues = await ccPrisma.$queryRaw`
    SELECT q.id::text, q.name, q.setup_queue_id::text, q.status::text
    FROM ccass.queues q
    WHERE q.organization_id = 1000
    ORDER BY q.id
  `;
  const setup = await ccPrisma.$queryRaw`
    SELECT id::text, name, status
    FROM accounts.setup_ccaas_queues
    WHERE organization_id = 1000
    ORDER BY id
  `;
  const stale = await ccPrisma.$executeRaw`
    UPDATE ccass.channel_automation_policies p
    SET default_queue_id = NULL, updated_at = NOW()
    WHERE p.organization_id = 1000
      AND p.default_queue_id IS NOT NULL
      AND NOT EXISTS (
        SELECT 1 FROM ccass.queues q
        WHERE q.id = p.default_queue_id
          AND q.organization_id = p.organization_id
      )
  `;
  console.log(JSON.stringify({ widgets, queues, setup, policies, clearedStaleDefaultQueues: stale }, null, 2));
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await ccPrisma.$disconnect();
  });
