/**
 * Backfill canonical channel automation policies for all active channels in an org.
 *
 * Usage:
 *   ORGANIZATION_ID=1000 npx tsx apps/cc-core/scripts/backfill-all-channel-policies.ts --apply
 */
import "@ai-contact-center/config/load-root-env";
import { ccPrisma } from "@ai-contact-center/db-cc";
import {
  resolveChannelPolicy,
  upsertChannelPolicy,
} from "../src/services/channel-policies.js";
import { upsertWhatsAppChannelPolicy } from "../src/services/whatsapp-policies.js";

const ORG_ID = process.env.ORGANIZATION_ID ?? "1000";
const apply = process.argv.includes("--apply");
const QUEUE_ID = process.env.WEBCHAT_QUEUE_ID ?? "1000";

async function main() {
  await ccPrisma.$executeRaw`SELECT set_config('app.is_staff', 'true', true)`;

  const channels = await ccPrisma.$queryRaw<
    Array<{ channel_config_id: string; channel: string; account_email: string | null }>
  >`
    SELECT wc.channel_config_id, 'webchat' AS channel, NULL::text AS account_email
    FROM accounts.setup_webchat_configs wc
    JOIN accounts.setup_channel_configs cc ON cc.id = wc.channel_config_id
    WHERE cc.organization_id = ${ORG_ID}::bigint AND cc.status = 'active'
    UNION ALL
    SELECT ec.channel_config_id, 'email' AS channel,
      COALESCE(NULLIF(trim(ec.sender_email), ''), oauth.account_email) AS account_email
    FROM accounts.setup_email_configs ec
    JOIN accounts.setup_channel_configs cc ON cc.id = ec.channel_config_id
    LEFT JOIN accounts.mail_oauth_connections oauth ON oauth.id = ec.oauth_connection_id
    WHERE cc.organization_id = ${ORG_ID}::bigint AND cc.status = 'active' AND cc.channel_type = 'email'
    UNION ALL
    SELECT sc.channel_config_id, sc.provider AS channel, NULL::text AS account_email
    FROM accounts.setup_social_configs sc
    JOIN accounts.setup_channel_configs cc ON cc.id = sc.channel_config_id
    WHERE cc.organization_id = ${ORG_ID}::bigint AND cc.status = 'active'
      AND sc.provider IN ('whatsapp', 'instagram', 'facebook')
  `;

  const report: Array<{ channel: string; channelConfigId: string; action: string }> = [];

  for (const row of channels) {
    const channel = row.channel as "webchat" | "email" | "whatsapp" | "instagram" | "facebook";
    const resolved = await resolveChannelPolicy(ccPrisma, ORG_ID, {
      channelConfigId: String(row.channel_config_id),
      channel,
      ...(row.account_email ? { accountEmail: row.account_email } : {}),
    });

    const queueId = resolved.defaultQueueId ?? QUEUE_ID;

    if (apply) {
      if (channel === "whatsapp") {
        await upsertWhatsAppChannelPolicy(ccPrisma, ORG_ID, {
          channelConfigId: String(row.channel_config_id),
          botEnabled: resolved.botEnabled,
          liveAgentEnabled: resolved.liveAgentEnabled,
          confidenceThreshold: resolved.confidenceThreshold,
          defaultQueueId: queueId,
          approvedHandoffMessage: resolved.handoffMessage,
        });
      }

      await upsertChannelPolicy(ccPrisma, ORG_ID, {
        channelConfigId: String(row.channel_config_id),
        channel,
        botEnabled: resolved.botEnabled,
        liveAgentEnabled: resolved.liveAgentEnabled,
        automationMode: resolved.automationMode,
        confidenceThreshold: resolved.confidenceThreshold,
        defaultQueueId: queueId,
        allowedQueueIds: resolved.allowedQueueIds,
        handoffMessage: resolved.handoffMessage,
        noAgentBehavior: resolved.noAgentBehavior,
        inactivityCloseSeconds: resolved.inactivityCloseSeconds,
        shadowMode: resolved.shadowMode,
        channelSettings: {
          backfilledAt: new Date().toISOString(),
          source: resolved.source,
        },
      });
    }

    report.push({
      channel,
      channelConfigId: String(row.channel_config_id),
      action: apply ? "upserted" : "would upsert",
    });
  }

  console.log(JSON.stringify({ organizationId: ORG_ID, apply, queueId: QUEUE_ID, report }, null, 2));
}

main()
  .catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await ccPrisma.$disconnect();
  });
