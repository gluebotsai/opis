/**
 * Enable WhatsApp routing for E2E test agents on org 1000 support queue.
 */
import "@ai-contact-center/config/load-root-env";
import { ccPrisma } from "@ai-contact-center/db-cc";
import { publishQueueToRouting } from "../apps/cc-core/src/services/queue-publish.js";

const ORG_ID = process.env.ORGANIZATION_ID ?? "1000";
const QUEUE_ID = process.env.QUEUE_ID ?? "1001";
const AGENT_EMAILS = [
  "agent.test@worktual.local",
  "agent2.test@worktual.local",
];

async function main() {
  await ccPrisma.$executeRaw`SELECT set_config('app.is_staff', 'true', true)`;

  for (const email of AGENT_EMAILS) {
    const user = await ccPrisma.setup_users.findFirst({
      where: {
        organization_id: BigInt(ORG_ID),
        work_email: { equals: email, mode: "insensitive" },
      },
      select: { id: true, work_email: true },
    });
    if (!user) {
      console.warn(`Skip missing user: ${email}`);
      continue;
    }

    await ccPrisma.setup_ccaas_queue_agents.updateMany({
      where: {
        queue_id: BigInt(QUEUE_ID),
        user_id: user.id,
        shift_type: "Regular",
      },
      data: {
        handles_whatsapp: true,
        whatsapp_concurrency: 2,
        handles_chat: true,
        handles_email: true,
        handles_social: true,
      },
    });

    const agent = await ccPrisma.agents.findFirst({
      where: { organization_id: BigInt(ORG_ID), setup_user_id: user.id },
      select: { id: true },
    });
    if (!agent) {
      console.warn(`Skip missing runtime agent: ${email}`);
      continue;
    }

    await ccPrisma.$executeRaw`
      INSERT INTO ccass.agent_capacity (
        organization_id, agent_id, channel, max_concurrency, reserved_count, active_count
      ) VALUES (
        ${ORG_ID}::bigint,
        ${agent.id}::bigint,
        'whatsapp',
        2,
        0,
        0
      )
      ON CONFLICT (agent_id, channel) DO UPDATE
        SET max_concurrency = 2, updated_at = NOW()
    `;

    await ccPrisma.agent_presence.upsert({
      where: { agent_id: agent.id },
      create: {
        organization_id: BigInt(ORG_ID),
        agent_id: agent.id,
        status: "ready",
        presence_state: "ready",
        source: "wa_routing_fix",
        heartbeat_at: new Date(),
        lease_expires_at: new Date(Date.now() + 90_000),
      },
      update: {
        status: "ready",
        presence_state: "ready",
        source: "wa_routing_fix",
        heartbeat_at: new Date(),
        lease_expires_at: new Date(Date.now() + 90_000),
      },
    });

    console.log(`Updated ${email} (agent ${agent.id}) for WhatsApp`);
  }

  await publishQueueToRouting(ccPrisma, ORG_ID, QUEUE_ID);

  // Ensure WhatsApp channel policy exists
  const channel = await ccPrisma.$queryRaw<Array<{ channel_config_id: string }>>`
    SELECT cc.id::text AS channel_config_id
    FROM accounts.setup_channel_configs cc
    INNER JOIN accounts.setup_social_configs sc ON sc.channel_config_id = cc.id
    WHERE cc.organization_id = ${ORG_ID}::bigint
      AND cc.status = 'active'
      AND sc.provider = 'whatsapp'
    ORDER BY cc.updated_at DESC
    LIMIT 1
  `;
  const channelConfigId = channel[0]?.channel_config_id;
  if (channelConfigId) {
    await ccPrisma.$executeRaw`
      INSERT INTO ccass.whatsapp_channel_policies (
        organization_id, channel_config_id, bot_enabled, live_agent_enabled,
        confidence_threshold, default_queue_id, status
      ) VALUES (
        ${ORG_ID}::bigint,
        ${channelConfigId}::bigint,
        TRUE,
        TRUE,
        0.500,
        ${QUEUE_ID}::bigint,
        'active'
      )
      ON CONFLICT (organization_id, channel_config_id) DO UPDATE SET
        live_agent_enabled = TRUE,
        default_queue_id = COALESCE(EXCLUDED.default_queue_id, ccass.whatsapp_channel_policies.default_queue_id),
        updated_at = NOW()
    `;
    console.log(`WhatsApp policy upserted for channel ${channelConfigId}`);
  }

  console.log("Done. Republished queue", QUEUE_ID);
}

main()
  .catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await ccPrisma.$disconnect();
  });
