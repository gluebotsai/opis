#!/usr/bin/env npx tsx
/**
 * Dry-run and backfill channel automation policies from legacy sources.
 *
 * Usage:
 *   npx tsx apps/cc-core/scripts/backfill-channel-policies.ts --dry-run
 *   npx tsx apps/cc-core/scripts/backfill-channel-policies.ts --apply
 */
import { ccPrisma } from "@ai-contact-center/db-cc";
import {
  resolveChannelPolicy,
  upsertChannelPolicy,
} from "../src/services/channel-policies.js";

type ChannelRow = {
  organization_id: string;
  channel_config_id: string;
  channel: string;
  account_email: string | null;
};

async function listActiveChannels(): Promise<ChannelRow[]> {
  const webchat = await ccPrisma.$queryRaw<ChannelRow[]>`
    SELECT cc.organization_id, cc.id AS channel_config_id, 'webchat' AS channel, NULL::text AS account_email
    FROM accounts.setup_channel_configs cc
    JOIN accounts.setup_webchat_configs wc ON wc.channel_config_id = cc.id
    WHERE cc.status = 'active'
  `;

  const email = await ccPrisma.$queryRaw<ChannelRow[]>`
    SELECT
      cc.organization_id,
      cc.id AS channel_config_id,
      'email' AS channel,
      COALESCE(NULLIF(trim(ec.sender_email), ''), oauth.account_email) AS account_email
    FROM accounts.setup_channel_configs cc
    JOIN accounts.setup_email_configs ec ON ec.channel_config_id = cc.id
    LEFT JOIN accounts.mail_oauth_connections oauth ON oauth.id = ec.oauth_connection_id
    WHERE cc.status = 'active' AND cc.channel_type = 'email'
  `;

  const whatsapp = await ccPrisma.$queryRaw<ChannelRow[]>`
    SELECT cc.organization_id, cc.id AS channel_config_id, 'whatsapp' AS channel, NULL::text AS account_email
    FROM accounts.setup_channel_configs cc
    JOIN accounts.setup_social_configs sc ON sc.channel_config_id = cc.id
    WHERE cc.status = 'active' AND sc.provider = 'whatsapp'
  `;

  return [...webchat, ...email, ...whatsapp];
}

async function main(): Promise<void> {
  const apply = process.argv.includes("--apply");
  const dryRun = !apply;

  const channels = await listActiveChannels();
  console.log(`Found ${channels.length} active channels\n`);

  const report: Array<{
    channel: string;
    channelConfigId: string;
    source: string;
    botEnabled: boolean;
    liveAgentEnabled: boolean;
    action: string;
  }> = [];

  for (const row of channels) {
    const channel = row.channel as "webchat" | "email" | "whatsapp";
    const resolved = await resolveChannelPolicy(ccPrisma, row.organization_id, {
      channelConfigId: row.channel_config_id,
      channel,
      ...(row.account_email ? { accountEmail: row.account_email } : {}),
    });

    const existing = await ccPrisma.$queryRaw<Array<{ id: string }>>`
      SELECT id FROM ccass.channel_automation_policies
      WHERE organization_id = ${row.organization_id}::bigint
        AND channel_config_id = ${row.channel_config_id}::bigint
      LIMIT 1
    `;

    const action = existing[0] ? "skip (already canonical)" : dryRun ? "would backfill" : "backfill";

    if (!existing[0] && apply) {
      await upsertChannelPolicy(ccPrisma, row.organization_id, {
        channelConfigId: row.channel_config_id,
        channel,
        botEnabled: resolved.botEnabled,
        liveAgentEnabled: resolved.liveAgentEnabled,
        automationMode: resolved.automationMode,
        confidenceThreshold: resolved.confidenceThreshold,
        defaultQueueId: resolved.defaultQueueId,
        allowedQueueIds: resolved.allowedQueueIds,
        handoffMessage: resolved.handoffMessage,
        noAgentBehavior: resolved.noAgentBehavior,
        inactivityCloseSeconds: resolved.inactivityCloseSeconds,
        shadowMode: resolved.shadowMode,
        channelSettings: {
          migratedFrom: resolved.source,
          migratedAt: new Date().toISOString(),
        },
      });
    }

    report.push({
      channel,
      channelConfigId: row.channel_config_id,
      source: resolved.source,
      botEnabled: resolved.botEnabled,
      liveAgentEnabled: resolved.liveAgentEnabled,
      action,
    });
  }

  console.table(report);
  console.log(`\n${dryRun ? "Dry run complete. Use --apply to backfill." : "Backfill complete."}`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => ccPrisma.$disconnect());
