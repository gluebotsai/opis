/**
 * Reset worktual1 org: wipe all interaction data, remove queues,
 * create a fresh omnichannel queue with 2 agents.
 *
 * Usage:
 *   npx tsx apps/cc-core/scripts/reset-worktual1-workspace.ts
 *   npx tsx apps/cc-core/scripts/reset-worktual1-workspace.ts --live
 */
import "@ai-contact-center/config/load-root-env";
import { randomUUID } from "node:crypto";
import { ccPrisma } from "@ai-contact-center/db-cc";
import { publishQueueToRouting } from "../src/services/queue-publish.js";

const ORG_ID = process.env.ORGANIZATION_ID ?? "ce4ff326-4c0e-43f2-a978-e6b494cd0775";
const AGENT_EMAILS = [
  "agent.test@worktual.local",
  "yaswanthmg1@gmail.com",
];
const NEW_QUEUE_NAME = process.env.NEW_QUEUE_NAME ?? "Support queue";
const live = process.argv.includes("--live");

async function preview() {
  await ccPrisma.$executeRaw`SELECT set_config('app.is_staff', 'true', true)`;
  await ccPrisma.$executeRaw`SELECT set_config('app.organization_id', ${ORG_ID}, true)`;

  const counts = await ccPrisma.$queryRaw<
    Array<{
      conversations: number;
      interactions: number;
      queues: number;
      routing_queues: number;
    }>
  >`
    SELECT
      (SELECT COUNT(*)::int FROM ccass.conversations WHERE organization_id = ${ORG_ID}::bigint) AS conversations,
      (SELECT COUNT(*)::int FROM cdp.interactions WHERE organization_id = ${ORG_ID}::bigint) AS interactions,
      (SELECT COUNT(*)::int FROM accounts.setup_ccaas_queues WHERE organization_id = ${ORG_ID}::bigint) AS queues,
      (SELECT COUNT(*)::int FROM ccass.queues WHERE organization_id = ${ORG_ID}::bigint) AS routing_queues
  `;

  const queues = await ccPrisma.$queryRaw<Array<{ id: string; name: string }>>`
    SELECT id, name FROM accounts.setup_ccaas_queues WHERE organization_id = ${ORG_ID}::bigint
  `;

  const agents = await ccPrisma.$queryRaw<
    Array<{ email: string; user_id: string; agent_id: string | null }>
  >`
    SELECT lower(u.work_email) AS email, u.id AS user_id, a.id AS agent_id
    FROM accounts.setup_users u
    LEFT JOIN ccass.agents a ON a.setup_user_id = u.id AND a.organization_id = u.organization_id
    WHERE u.organization_id = ${ORG_ID}::bigint
      AND lower(u.work_email) = ANY(${AGENT_EMAILS.map((e) => e.toLowerCase())}::text[])
  `;

  return { counts: counts[0], queues, agents };
}

async function wipeInteractions(db: typeof ccPrisma) {
  await db.$executeRaw`SELECT set_config('app.is_staff', 'true', true)`;
  await db.$executeRaw`SELECT set_config('app.organization_id', ${ORG_ID}, true)`;

  const conversationIds = await db.$queryRaw<Array<{ id: string }>>`
    SELECT id FROM ccass.conversations WHERE organization_id = ${ORG_ID}::bigint
  `;
  const ids = conversationIds.map((r) => r.id);

  if (ids.length > 0) {
    await db.$executeRaw`
      DELETE FROM cdp.interaction_events
      WHERE organization_id = ${ORG_ID}::bigint
        AND interaction_id IN (
          SELECT id FROM cdp.interactions WHERE organization_id = ${ORG_ID}::bigint
        )
    `;
    await db.$executeRaw`
      DELETE FROM cdp.interactions WHERE organization_id = ${ORG_ID}::bigint
    `;
    await db.$executeRaw`
      DELETE FROM ccass.email_provider_events
      WHERE organization_id = ${ORG_ID}::bigint
    `;
    await db.$executeRaw`
      DELETE FROM ccass.email_delivery_outbox
      WHERE organization_id = ${ORG_ID}::bigint
    `;
    await db.$executeRaw`
      DELETE FROM ccass.routing_attempts
      WHERE organization_id = ${ORG_ID}::bigint
    `;
    await db.$executeRaw`
      DELETE FROM ccass.conversations
      WHERE organization_id = ${ORG_ID}::bigint
    `;
  }

  await db.$executeRaw`
    DELETE FROM ccass.copilot_sessions WHERE organization_id = ${ORG_ID}::bigint
  `;
  await db.$executeRaw`
    DELETE FROM ccass.copilot_memory WHERE organization_id = ${ORG_ID}::bigint
  `;

  await db.$executeRaw`
    UPDATE ccass.agent_capacity ac
    SET active_count = 0, reserved_count = 0, updated_at = NOW()
    FROM ccass.agents a
    WHERE ac.agent_id = a.id AND a.organization_id = ${ORG_ID}::bigint
  `;

  await db.$executeRaw`
    UPDATE ccass.agent_presence ap
    SET presence_state = 'offline', status = 'offline', reason_code = NULL, updated_at = NOW()
    FROM ccass.agents a
    WHERE ap.agent_id = a.id AND a.organization_id = ${ORG_ID}::bigint
  `;
}

async function removeQueues(db: typeof ccPrisma) {
  const queueIds = await db.$queryRaw<Array<{ id: string }>>`
    SELECT id FROM accounts.setup_ccaas_queues WHERE organization_id = ${ORG_ID}::bigint
  `;
  const ids = queueIds.map((q) => q.id);
  if (ids.length === 0) return;

  await db.$executeRaw`
    UPDATE accounts.setup_webchat_configs wc
    SET routing_queue_id = NULL
    FROM accounts.setup_channel_configs cc
    WHERE cc.id = wc.channel_config_id AND cc.organization_id = ${ORG_ID}::bigint
  `;

  await db.$executeRaw`
    UPDATE ccass.email_mailbox_policies
    SET default_queue_id = NULL, updated_at = NOW()
    WHERE organization_id = ${ORG_ID}::bigint
  `;
  await db.$executeRaw`
    UPDATE ccass.whatsapp_channel_policies
    SET default_queue_id = NULL, updated_at = NOW()
    WHERE organization_id = ${ORG_ID}::bigint
  `;
  await db.$executeRaw`
    UPDATE ccass.channel_automation_policies
    SET default_queue_id = NULL, updated_at = NOW()
    WHERE organization_id = ${ORG_ID}::bigint
  `;

  await db.$executeRaw`
    DELETE FROM ccass.queue_members WHERE queue_id = ANY(${ids}::bigint[])
  `;
  await db.$executeRaw`
    DELETE FROM ccass.queue_routing_profiles WHERE queue_id = ANY(${ids}::bigint[])
  `;
  await db.$executeRaw`
    DELETE FROM ccass.queues WHERE organization_id = ${ORG_ID}::bigint
  `;
  await db.$executeRaw`
    DELETE FROM accounts.setup_ccaas_queues WHERE organization_id = ${ORG_ID}::bigint
  `;
}

async function createQueueWithAgents(
  db: typeof ccPrisma,
  teamId: string,
  agentUsers: Array<{ user_id: string; agent_id: string | null; email: string }>,
) {
  const queueId = randomUUID();

  await db.setup_ccaas_queues.create({
    data: {
      id: queueId,
      organization_id: ORG_ID,
      name: NEW_QUEUE_NAME,
      team_id: teamId,
      description: "Omnichannel support queue (webchat, email, WhatsApp)",
      status: "active",
      shift_types: ["Regular"],
      skills: ["general", "support"],
    },
  });

  for (const agent of agentUsers) {
    let agentId = agent.agent_id;
    if (!agentId) {
      const created = await db.agents.create({
        data: {
          organization_id: ORG_ID,
          setup_user_id: agent.user_id,
          display_name: agent.email.split("@")[0] ?? "Agent",
          email: agent.email,
          status: "offline",
        },
        select: { id: true },
      });
      agentId = created.id;
    }

    await db.setup_ccaas_queue_agents.create({
      data: {
        queue_id: queueId,
        user_id: agent.user_id,
        shift_type: "Regular",
        handles_chat: true,
        handles_email: true,
        handles_whatsapp: true,
        handles_social: true,
        chat_concurrency: 3,
        email_concurrency: 3,
        whatsapp_concurrency: 3,
        social_concurrency: 3,
        handles_calls: false,
        call_type: "both",
      },
    });

    await db.$executeRaw`
      INSERT INTO ccass.agent_capacity (organization_id, agent_id, channel, max_concurrency, reserved_count, active_count)
      VALUES
        (${ORG_ID}::bigint, ${agentId}::bigint, 'chat', 3, 0, 0),
        (${ORG_ID}::bigint, ${agentId}::bigint, 'email', 3, 0, 0),
        (${ORG_ID}::bigint, ${agentId}::bigint, 'whatsapp', 3, 0, 0)
      ON CONFLICT (agent_id, channel) DO UPDATE
        SET max_concurrency = 3, active_count = 0, reserved_count = 0, updated_at = NOW()
    `;
  }

  await publishQueueToRouting(db, ORG_ID, queueId);

  await db.$executeRaw`
    UPDATE accounts.setup_webchat_configs wc
    SET routing_queue_id = ${queueId}::bigint
    FROM accounts.setup_channel_configs cc
    WHERE cc.id = wc.channel_config_id AND cc.organization_id = ${ORG_ID}::bigint
  `;

  await db.$executeRaw`
    UPDATE ccass.email_mailbox_policies
    SET default_queue_id = ${queueId}::bigint, updated_at = NOW()
    WHERE organization_id = ${ORG_ID}::bigint
  `;

  await db.$executeRaw`
    UPDATE ccass.whatsapp_channel_policies
    SET default_queue_id = ${queueId}::bigint, updated_at = NOW()
    WHERE organization_id = ${ORG_ID}::bigint
  `;

  await db.$executeRaw`
    UPDATE ccass.channel_automation_policies
    SET default_queue_id = ${queueId}::bigint, updated_at = NOW()
    WHERE organization_id = ${ORG_ID}::bigint
  `;

  return queueId;
}

async function main() {
  const previewData = await preview();
  console.log(JSON.stringify({ organizationId: ORG_ID, live, ...previewData }, null, 2));

  if (previewData.agents.length < 2) {
    throw new Error(
      `Expected 2 agents (${AGENT_EMAILS.join(", ")}), found ${previewData.agents.length}`,
    );
  }

  if (!live) {
    console.log("\nDry run only. Re-run with --live to apply.");
    return;
  }

  const team = await ccPrisma.setup_teams.findFirst({
    where: { organization_id: ORG_ID },
    select: { id: true, name: true },
    orderBy: { created_at: "asc" },
  });
  if (!team) throw new Error("No team found for organization");

  await wipeInteractions(ccPrisma);
  await removeQueues(ccPrisma);

  const queueId = await createQueueWithAgents(ccPrisma, team.id, previewData.agents);

  console.log(
    JSON.stringify(
      {
        status: "complete",
        newQueueId: queueId,
        newQueueName: NEW_QUEUE_NAME,
        teamId: team.id,
        agents: previewData.agents.map((a) => a.email),
      },
      null,
      2,
    ),
  );
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await ccPrisma.$disconnect();
  });
