/**
 * Enable WhatsApp bot policy for an org's active WhatsApp channel.
 *
 * Usage:
 *   npx tsx apps/cc-core/scripts/enable-whatsapp-channel-bot.ts --live
 *   npx tsx apps/cc-core/scripts/enable-whatsapp-channel-bot.ts --live --channel-id <uuid>
 */
import "@ai-contact-center/config/load-root-env";
import { ccPrisma } from "@ai-contact-center/db-cc";

type ChannelRow = {
  organization_id: string;
  channel_config_id: string;
  queue_id: string | null;
};

const args = new Set(process.argv.slice(2));
const live = args.has("--live");
const channelArgIndex = process.argv.indexOf("--channel-id");
const queueArgIndex = process.argv.indexOf("--queue-id");
const channelId = channelArgIndex >= 0 ? process.argv[channelArgIndex + 1] : undefined;
const queueId = queueArgIndex >= 0 ? process.argv[queueArgIndex + 1] : undefined;

const channels = await ccPrisma.$transaction(async (db) => {
  await db.$executeRaw`SELECT set_config('app.is_staff', 'true', true)`;
  return db.$queryRaw<ChannelRow[]>`
    SELECT
      cc.organization_id,
      cc.id AS channel_config_id,
      (
        SELECT q.id
        FROM ccass.queues q
        INNER JOIN ccass.queue_members member ON member.queue_id = q.id
        WHERE q.organization_id = cc.organization_id
          AND q.status = 'active'
          AND member.handles_whatsapp = TRUE
        ORDER BY q.published_at ASC NULLS LAST, q.id ASC
        LIMIT 1
      ) AS queue_id
    FROM accounts.setup_channel_configs cc
    INNER JOIN accounts.setup_social_configs wc ON wc.channel_config_id = cc.id
    WHERE cc.status = 'active'
      AND wc.provider = 'whatsapp'
    ORDER BY cc.updated_at DESC
  `;
});

if (channels.length === 0) {
  console.log("No active Setup WhatsApp channels found.");
  await ccPrisma.$disconnect();
  process.exit(0);
}

console.log(JSON.stringify({ channels }, null, 2));

if (!live) {
  await ccPrisma.$disconnect();
  process.exit(0);
}

const target =
  (channelId ? channels.find((channel) => channel.channel_config_id === channelId) : undefined) ??
  channels[0];

if (!target) {
  console.error("No WhatsApp channel selected.");
  await ccPrisma.$disconnect();
  process.exit(1);
}

const resolvedQueueId = queueId ?? target.queue_id;

await ccPrisma.$transaction(async (db) => {
  await db.$executeRaw`
    SELECT set_config('app.organization_id', ${target.organization_id}, true)
  `;
  await db.$executeRaw`
    INSERT INTO ccass.whatsapp_channel_policies (
      organization_id,
      channel_config_id,
      bot_enabled,
      live_agent_enabled,
      confidence_threshold,
      default_queue_id,
      status
    ) VALUES (
      ${target.organization_id}::bigint,
      ${target.channel_config_id}::bigint,
      TRUE,
      TRUE,
      0.500,
      ${resolvedQueueId ?? null}::bigint,
      'active'
    )
    ON CONFLICT (organization_id, channel_config_id) DO UPDATE SET
      bot_enabled = EXCLUDED.bot_enabled,
      live_agent_enabled = EXCLUDED.live_agent_enabled,
      default_queue_id = COALESCE(EXCLUDED.default_queue_id, ccass.whatsapp_channel_policies.default_queue_id),
      updated_at = NOW()
  `;
  const policies = await db.$queryRaw`
    SELECT * FROM ccass.whatsapp_channel_policies
    WHERE organization_id = ${target.organization_id}::bigint
      AND channel_config_id = ${target.channel_config_id}::bigint
  `;
  console.log(JSON.stringify({ upserted: policies }, null, 2));
});

await ccPrisma.$disconnect();
