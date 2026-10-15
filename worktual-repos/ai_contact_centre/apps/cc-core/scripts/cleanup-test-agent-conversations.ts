/**
 * Remove conversation/chat interaction data for test agents only.
 * Does NOT delete user accounts, org config, queues, or routing setup.
 *
 * Usage:
 *   npx tsx apps/cc-core/scripts/cleanup-test-agent-conversations.ts
 *   npx tsx apps/cc-core/scripts/cleanup-test-agent-conversations.ts --live
 */
import "@ai-contact-center/config/load-root-env";
import { ccPrisma } from "@ai-contact-center/db-cc";

const ORG_ID = process.env.ORGANIZATION_ID ?? "ce4ff326-4c0e-43f2-a978-e6b494cd0775";
const AGENT_EMAILS = [
  "agent.test@worktual.local",
  "yaswanthmg1@gmail.com",
  "yaswanthm1@gmail.com",
  "yaswanth2345@gmail.com",
];

const live = process.argv.includes("--live");

type AgentRow = { user_id: string; agent_id: string; email: string };

async function resolveAgents(): Promise<AgentRow[]> {
  const rows = await ccPrisma.$queryRaw<AgentRow[]>`
    SELECT
      u.id AS user_id,
      a.id AS agent_id,
      lower(u.work_email) AS email
    FROM accounts.setup_users u
    INNER JOIN ccass.agents a ON a.setup_user_id = u.id
    WHERE u.organization_id = ${ORG_ID}::bigint
      AND lower(u.work_email) = ANY(${AGENT_EMAILS.map((e) => e.toLowerCase())}::text[])
  `;
  return rows;
}

async function collectConversationIds(agentIds: string[], userIds: string[]): Promise<string[]> {
  if (agentIds.length === 0) return [];
  const rows = await ccPrisma.$queryRaw<Array<{ id: string }>>`
    SELECT DISTINCT c.id
    FROM ccass.conversations c
    WHERE c.organization_id = ${ORG_ID}::bigint
      AND (
        c.channel = 'webchat'
        OR c.assigned_agent_id = ANY(${agentIds}::bigint[])
        OR c.assigned_user_id = ANY(${userIds}::bigint[])
        OR EXISTS (
          SELECT 1 FROM ccass.conversation_assignments ca
          WHERE ca.conversation_id = c.id
            AND ca.agent_id = ANY(${agentIds}::bigint[])
        )
        OR EXISTS (
          SELECT 1 FROM ccass.conversation_transfers ct
          WHERE ct.conversation_id = c.id
            AND (
              ct.from_agent_id = ANY(${agentIds}::bigint[])
              OR ct.offered_agent_id = ANY(${agentIds}::bigint[])
            )
        )
      )
  `;
  return rows.map((row) => row.id);
}

async function main() {
  await ccPrisma.$executeRaw`SELECT set_config('app.is_staff', 'true', true)`;
  await ccPrisma.$executeRaw`SELECT set_config('app.organization_id', ${ORG_ID}, true)`;

  const agents = await resolveAgents();
  if (agents.length === 0) {
    throw new Error(`No test agents found for emails: ${AGENT_EMAILS.join(", ")}`);
  }

  const agentIds = agents.map((a) => a.agent_id);
  const userIds = agents.map((a) => a.user_id);
  const conversationIds = await collectConversationIds(agentIds, userIds);

  const counts = await ccPrisma.$queryRaw<
    Array<{ messages: number; nlp_turns: number; copilot_sessions: number }>
  >`
    SELECT
      (SELECT COUNT(*)::int FROM ccass.conversation_messages m
        WHERE m.conversation_id = ANY(${conversationIds}::bigint[])) AS messages,
      (SELECT COUNT(*)::int FROM ccass.nlp_turns t
        WHERE t.conversation_id = ANY(${conversationIds}::bigint[])) AS nlp_turns,
      (SELECT COUNT(*)::int FROM ccass.copilot_sessions s
        WHERE s.organization_id = ${ORG_ID}::bigint
          AND s.user_id = ANY(${userIds}::bigint[])) AS copilot_sessions
  `;

  console.log(
    JSON.stringify(
      {
        organizationId: ORG_ID,
        live,
        agents: agents.map((a) => ({ email: a.email, agentId: a.agent_id, userId: a.user_id })),
        conversationsToDelete: conversationIds.length,
        conversationSample: conversationIds.slice(0, 8),
        relatedCounts: counts[0] ?? { messages: 0, nlp_turns: 0, copilot_sessions: 0 },
      },
      null,
      2,
    ),
  );

  if (!live) {
    console.log("\nDry run only. Re-run with --live to delete.");
    return;
  }

  await ccPrisma.$transaction(async (db) => {
    await db.$executeRaw`SELECT set_config('app.is_staff', 'true', true)`;
    await db.$executeRaw`SELECT set_config('app.organization_id', ${ORG_ID}, true)`;

    if (conversationIds.length > 0) {
      await db.$executeRaw`
        DELETE FROM cdp.interaction_events
        WHERE organization_id = ${ORG_ID}::bigint
          AND conversation_id = ANY(${conversationIds}::bigint[])
      `;
      await db.$executeRaw`
        DELETE FROM cdp.interactions
        WHERE organization_id = ${ORG_ID}::bigint
          AND conversation_id = ANY(${conversationIds}::bigint[])
      `;
      await db.$executeRaw`
        DELETE FROM ccass.routing_attempts
        WHERE organization_id = ${ORG_ID}::bigint
          AND conversation_id = ANY(${conversationIds}::bigint[])
      `;
      await db.$executeRaw`
        DELETE FROM ccass.conversations
        WHERE organization_id = ${ORG_ID}::bigint
          AND id = ANY(${conversationIds}::bigint[])
      `;
    }

    await db.$executeRaw`
      DELETE FROM ccass.copilot_sessions
      WHERE organization_id = ${ORG_ID}::bigint
        AND user_id = ANY(${userIds}::bigint[])
    `;
    await db.$executeRaw`
      DELETE FROM ccass.copilot_memory
      WHERE organization_id = ${ORG_ID}::bigint
        AND user_id = ANY(${userIds}::bigint[])
    `;
  });

  await ccPrisma.$executeRaw`
    UPDATE ccass.agent_capacity ac
    SET active_count = 0,
        reserved_count = 0,
        updated_at = NOW()
    FROM ccass.agents a
    WHERE ac.agent_id = a.id
      AND a.id = ANY(${agentIds}::bigint[])
  `;

  await ccPrisma.$executeRaw`
    UPDATE ccass.agent_presence ap
    SET presence_state = 'offline',
        status = 'offline',
        reason_code = NULL,
        updated_at = NOW()
    WHERE ap.agent_id = ANY(${agentIds}::bigint[])
  `;

  console.log("Cleanup complete.");
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await ccPrisma.$disconnect();
  });
