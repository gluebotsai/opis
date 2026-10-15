/**
 * Ensure both Playwright webchat test agents are on the webchat routing queue.
 *
 * Usage:
 *   npx tsx apps/cc-core/scripts/ensure-webchat-two-agents.ts --live
 */
import "@ai-contact-center/config/load-root-env";
import { ccPrisma } from "@ai-contact-center/db-cc";
import { publishQueueToRouting } from "../src/services/queue-publish.js";

const ORG_ID = process.env.ORGANIZATION_ID ?? "1000";
const ORG_BI = BigInt(ORG_ID);
const WEBCHAT_ID = process.env.WEBCHAT_ID ?? "wc_5d80cd9b1ace4080bc70717552472611";
const AGENT_EMAILS = [
  process.env.PLAYWRIGHT_AGENT_A_EMAIL ?? "agent.test@worktual.local",
  process.env.PLAYWRIGHT_AGENT_B_EMAIL ?? "agent2.test@worktual.local",
].map((email) => email.trim().toLowerCase());

async function resolveWebchatQueueId(): Promise<string> {
  const fromEnv = process.env.WEBCHAT_QUEUE_ID?.trim();
  if (fromEnv) return fromEnv;

  const rows = await ccPrisma.$queryRaw<Array<{ routing_queue_id: string | null }>>`
    SELECT routing_queue_id
    FROM accounts.setup_webchat_configs
    WHERE webchat_id = ${WEBCHAT_ID}
    LIMIT 1
  `;
  const queueId = rows[0]?.routing_queue_id;
  if (!queueId) {
    throw new Error(`No routing queue configured for webchat ${WEBCHAT_ID}`);
  }
  return String(queueId);
}

async function ensureAgentOnQueue(queueId: string, email: string) {
  const user = await ccPrisma.setup_users.findFirst({
    where: {
      organization_id: ORG_BI,
      work_email: { equals: email, mode: "insensitive" },
    },
    select: { id: true, work_email: true },
  });
  if (!user) {
    throw new Error(`Agent user not found: ${email}`);
  }

  const queue = await ccPrisma.setup_ccaas_queues.findFirst({
    where: { id: BigInt(queueId), organization_id: ORG_BI },
    select: { team_id: true },
  });
  if (!queue?.team_id) {
    throw new Error(`Queue ${queueId} not found for organization ${ORG_ID}`);
  }

  await ccPrisma.setup_users.update({
    where: { id: user.id },
    data: { team_id: queue.team_id },
  });

  const existingQueueAgent = await ccPrisma.setup_ccaas_queue_agents.findFirst({
    where: {
      queue_id: BigInt(queueId),
      user_id: user.id,
      shift_type: "Regular",
    },
    select: { id: true },
  });

  if (existingQueueAgent) {
    await ccPrisma.setup_ccaas_queue_agents.update({
      where: { id: existingQueueAgent.id },
      data: {
        handles_chat: true,
        chat_concurrency: 3,
      },
    });
  } else {
    await ccPrisma.setup_ccaas_queue_agents.create({
      data: {
        queue_id: BigInt(queueId),
        user_id: user.id,
        shift_type: "Regular",
        handles_chat: true,
        chat_concurrency: 3,
        handles_calls: false,
        handles_email: false,
        call_type: "both",
      },
    });
  }

  const agent = await ccPrisma.agents.findFirst({
    where: { organization_id: ORG_BI, setup_user_id: user.id },
    select: { id: true },
  });
  if (!agent) {
    throw new Error(`Runtime agent row missing for ${email}`);
  }

  await ccPrisma.$executeRaw`
    INSERT INTO ccass.agent_capacity (
      organization_id, agent_id, channel, max_concurrency, reserved_count, active_count
    ) VALUES (
      ${ORG_ID}::bigint,
      ${agent.id}::bigint,
      'chat',
      3,
      0,
      0
    )
    ON CONFLICT (agent_id, channel) DO UPDATE
      SET max_concurrency = 3, updated_at = NOW()
  `;

  await ccPrisma.agent_presence.upsert({
    where: { agent_id: agent.id },
    create: {
      organization_id: ORG_BI,
      agent_id: agent.id,
      status: "ready",
      presence_state: "ready",
      source: "e2e_setup",
      heartbeat_at: new Date(),
      lease_expires_at: new Date(Date.now() + 90_000),
    },
    update: {
      status: "ready",
      presence_state: "ready",
      source: "e2e_setup",
      heartbeat_at: new Date(),
      lease_expires_at: new Date(Date.now() + 90_000),
    },
  });

  await ccPrisma.$executeRaw`
    UPDATE ccass.agent_presence
    SET
      status = 'ready',
      presence_state = 'ready',
      heartbeat_at = NOW(),
      lease_expires_at = NOW() + INTERVAL '90 seconds',
      source = 'e2e_setup',
      updated_at = NOW()
    WHERE agent_id = ${agent.id}::bigint
      AND organization_id = ${ORG_ID}::bigint
  `;

  return { email: user.work_email, userId: String(user.id), agentId: String(agent.id) };
}

async function main() {
  const live = process.argv.includes("--live");
  const queueId = await resolveWebchatQueueId();
  const provisioned = [];

  for (const email of AGENT_EMAILS) {
    provisioned.push(await ensureAgentOnQueue(queueId, email));
  }

  if (live) {
    await publishQueueToRouting(ccPrisma, ORG_ID, queueId);
  }

  console.log(
    JSON.stringify(
      {
        organizationId: ORG_ID,
        webchatId: WEBCHAT_ID,
        queueId,
        live,
        agents: provisioned,
      },
      (_, value) => (typeof value === "bigint" ? String(value) : value),
      2,
    ),
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
