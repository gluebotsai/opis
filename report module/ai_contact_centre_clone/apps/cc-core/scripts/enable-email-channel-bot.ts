/**
 * Operational helper: inspect Setup email channels and optionally upsert mailbox policy.
 *
 * Usage:
 *   npx tsx apps/cc-core/scripts/enable-email-channel-bot.ts
 *   npx tsx apps/cc-core/scripts/enable-email-channel-bot.ts --shadow
 *   npx tsx apps/cc-core/scripts/enable-email-channel-bot.ts --live --queue-id <uuid>
 */
import { ccPrisma } from "@ai-contact-center/db-cc";

import {
  resolveEmailMailboxPolicy,
  upsertEmailMailboxPolicy,
} from "../src/services/email-policies.js";

type ChannelRow = {
  organization_id: string;
  channel_config_id: string;
  account_email: string;
  ccaas_handler: string | null;
  needs_reauth: boolean | null;
  scope: string | null;
  queue_id: string | null;
};

const args = new Set(process.argv.slice(2));
const shadow = args.has("--shadow");
const live = args.has("--live");
const queueArgIndex = process.argv.indexOf("--queue-id");
const channelArgIndex = process.argv.indexOf("--channel-id");
const queueId = queueArgIndex >= 0 ? process.argv[queueArgIndex + 1] : undefined;
const channelId = channelArgIndex >= 0 ? process.argv[channelArgIndex + 1] : undefined;

const channels = await ccPrisma.$transaction(async (db) => {
  await db.$executeRaw`SELECT set_config('app.is_staff', 'true', true)`;
  return db.$queryRaw<ChannelRow[]>`
    SELECT
      cc.organization_id,
      cc.id AS channel_config_id,
      COALESCE(NULLIF(trim(ec.sender_email), ''), oauth.account_email) AS account_email,
      ec.ccaas_handler,
      oauth.needs_reauth,
      oauth.scope,
      (
        SELECT q.id
        FROM ccass.queues q
        INNER JOIN ccass.queue_members member ON member.queue_id = q.id
        WHERE q.organization_id = cc.organization_id
          AND q.status = 'active'
          AND member.handles_email = TRUE
        ORDER BY q.published_at ASC NULLS LAST, q.id ASC
        LIMIT 1
      ) AS queue_id
    FROM accounts.setup_channel_configs cc
    INNER JOIN accounts.setup_email_configs ec
      ON ec.channel_config_id = cc.id
    LEFT JOIN accounts.mail_oauth_connections oauth
      ON oauth.id = ec.oauth_connection_id
    WHERE cc.channel_type = 'email'
      AND cc.status = 'active'
    ORDER BY cc.updated_at DESC
  `;
});

if (channels.length === 0) {
  console.log("No active Setup email channels found.");
  await ccPrisma.$disconnect();
  process.exit(0);
}

console.log(JSON.stringify({ channels }, null, 2));

if (!shadow && !live) {
  await ccPrisma.$disconnect();
  process.exit(0);
}

const oauthChannels = channels.filter((channel) => channel.needs_reauth === false && channel.scope);
const target =
  (channelId
    ? channels.find((channel) => channel.channel_config_id === channelId)
    : undefined) ??
  oauthChannels[0] ??
  channels[0];
if (!target) {
  console.error("No email channel selected.");
  await ccPrisma.$disconnect();
  process.exit(1);
}

const resolvedQueueId = queueId ?? target.queue_id;
if (live && !resolvedQueueId) {
  console.error("Live auto-send requires an email-enabled queue. Pass --queue-id <uuid>.");
  await ccPrisma.$disconnect();
  process.exit(1);
}

await ccPrisma.$transaction(async (db) => {
  await db.$executeRaw`
    SELECT set_config('app.organization_id', ${target.organization_id}, true)
  `;
  const policy = await upsertEmailMailboxPolicy(db, target.organization_id, {
    connectionId: target.channel_config_id,
    accountEmail: target.account_email,
    botEnabled: true,
    liveAgentEnabled: true,
    shadowMode: shadow && !live,
    autoSendEnabled: live,
    confidenceThreshold: 0.85,
    defaultQueueId: resolvedQueueId ?? null,
    allowedQueueIds: resolvedQueueId ? [resolvedQueueId] : [],
    approvedServiceMessage: null,
  });
  const resolved = await resolveEmailMailboxPolicy(db, target.organization_id, {
    connectionId: target.channel_config_id,
    accountEmail: target.account_email,
  });
  console.log(JSON.stringify({ upserted: policy, resolved }, null, 2));
});

await ccPrisma.$disconnect();
