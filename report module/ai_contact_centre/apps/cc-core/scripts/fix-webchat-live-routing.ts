/**
 * Repair webchat live-agent routing for org 1000 staging widget.
 *
 * Usage:
 *   ORGANIZATION_ID=1000 WEBCHAT_ID=wc_... npx tsx apps/cc-core/scripts/fix-webchat-live-routing.ts
 */
import "@ai-contact-center/config/load-root-env";
import { ccPrisma } from "@ai-contact-center/db-cc";
import { publishQueueToRouting } from "../src/services/queue-publish.js";
import { upsertChannelPolicy } from "../src/services/channel-policies.js";

const ORG_ID = process.env.ORGANIZATION_ID ?? "1000";
const WEBCHAT_ID =
  process.env.WEBCHAT_ID ??
  process.env.PLAYWRIGHT_WEBCHAT_ID ??
  "wc_2108939a845e413b9ba84d6c400ec3fa";
const AGENT_EMAILS = [
  process.env.PLAYWRIGHT_AGENT_A_EMAIL ?? "agent.test@worktual.local",
  process.env.PLAYWRIGHT_AGENT_B_EMAIL ?? "agent2.test@worktual.local",
].map((email) => email.trim().toLowerCase());

function serialize(value: unknown): string {
  return JSON.stringify(value, (_key, current) =>
    typeof current === "bigint" ? current.toString() : current,
  );
}

async function setAgentsReady(queueId: string) {
  for (const email of AGENT_EMAILS) {
    const user = await ccPrisma.setup_users.findFirst({
      where: {
        organization_id: BigInt(ORG_ID),
        work_email: { equals: email, mode: "insensitive" },
      },
      select: { id: true },
    });
    if (!user) continue;

    const agent = await ccPrisma.agents.findFirst({
      where: { organization_id: BigInt(ORG_ID), setup_user_id: user.id },
      select: { id: true },
    });
    if (!agent) continue;

    await ccPrisma.$executeRaw`
      INSERT INTO ccass.agent_capacity (
        organization_id, agent_id, channel, max_concurrency, reserved_count, active_count
      ) VALUES (
        ${ORG_ID}::bigint, ${agent.id}::bigint, 'chat', 3, 0, 0
      )
      ON CONFLICT (agent_id, channel) DO UPDATE
        SET max_concurrency = 3, active_count = 0, reserved_count = 0, updated_at = NOW()
    `;

    await ccPrisma.agent_presence.upsert({
      where: { agent_id: agent.id },
      create: {
        organization_id: BigInt(ORG_ID),
        agent_id: agent.id,
        status: "ready",
        presence_state: "ready",
        source: "fix_webchat_routing",
        heartbeat_at: new Date(),
        lease_expires_at: new Date(Date.now() + 120_000),
      },
      update: {
        status: "ready",
        presence_state: "ready",
        source: "fix_webchat_routing",
        heartbeat_at: new Date(),
        lease_expires_at: new Date(Date.now() + 120_000),
      },
    });
  }
}

async function main() {
  await ccPrisma.$executeRaw`SELECT set_config('app.is_staff', 'true', true)`;

  const webchat = await ccPrisma.setup_webchat_configs.findUnique({
    where: { webchat_id: WEBCHAT_ID },
    select: {
      webchat_id: true,
      routing_queue_id: true,
      channel_config_id: true,
    },
  });
  if (!webchat?.routing_queue_id) {
    throw new Error(`Webchat ${WEBCHAT_ID} has no routing_queue_id in accounts.setup_webchat_configs`);
  }

  const queueId = String(webchat.routing_queue_id);
  await publishQueueToRouting(ccPrisma, ORG_ID, queueId);

  await upsertChannelPolicy(ccPrisma, ORG_ID, {
    channelConfigId: String(webchat.channel_config_id),
    channel: "webchat",
    botEnabled: true,
    liveAgentEnabled: true,
    defaultQueueId: queueId,
    automationMode: "auto_send",
    confidenceThreshold: 0.85,
    noAgentBehavior: "queue_and_notify",
    handoffMessage: "Please hold while we connect you with an agent.",
  });

  await ccPrisma.$executeRaw`
    INSERT INTO ccass.routing_policies (
      organization_id, queue_id, strategy, offer_timeout_seconds, max_attempts
    ) VALUES (
      ${ORG_ID}::bigint,
      ${queueId}::bigint,
      'skill_round_robin',
      20,
      3
    )
    ON CONFLICT (queue_id) DO UPDATE
      SET offer_timeout_seconds = 20, updated_at = NOW()
  `;

  await setAgentsReady(queueId);

  const verify = await ccPrisma.$queryRaw<
    Array<{
      routing_setup_queue_id: string | null;
      routing_queue_id: string | null;
      queue_members: number;
      ready_agents: number;
    }>
  >`
    SELECT
      wc.routing_queue_id AS routing_setup_queue_id,
      rq.id AS routing_queue_id,
      (SELECT COUNT(*)::int FROM ccass.queue_members qm WHERE qm.queue_id = rq.id) AS queue_members,
      (
        SELECT COUNT(*)::int
        FROM ccass.queue_members qm
        JOIN ccass.agent_presence ap ON ap.agent_id = qm.agent_id
        WHERE qm.queue_id = rq.id
          AND qm.handles_chat = TRUE
          AND ap.presence_state = 'ready'
      ) AS ready_agents
    FROM accounts.setup_webchat_configs wc
    LEFT JOIN ccass.queues rq ON rq.setup_queue_id = wc.routing_queue_id
    WHERE wc.webchat_id = ${WEBCHAT_ID}
    LIMIT 1
  `;

  console.log(
    serialize({
      organizationId: ORG_ID,
      webchatId: WEBCHAT_ID,
      queueId,
      verify: verify[0] ?? null,
    }),
  );
}

main()
  .catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await ccPrisma.$disconnect();
  });
