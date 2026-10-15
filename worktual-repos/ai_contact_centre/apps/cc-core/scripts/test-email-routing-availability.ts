/**
 * Verify queued email routing when an agent becomes available.
 *
 * Usage:
 *   npx tsx scripts/test-email-routing-availability.ts
 *   npx tsx scripts/test-email-routing-availability.ts --assign agent.test@worktual.local
 *
 * --assign simulates the agent switching to busy and draining one queued email.
 */
import "@ai-contact-center/config/load-root-env";
import { ccPrisma } from "@ai-contact-center/db-cc";

import { routeOldestQueuedConversationForAgent } from "../src/services/conversations.js";
import { setAgentPresenceByAgentId } from "../src/services/presence.js";

const ORG = process.env.ORGANIZATION_ID ?? "ce4ff326-4c0e-43f2-a978-e6b494cd0775";
const assignEmail = process.argv.includes("--assign")
  ? process.argv[process.argv.indexOf("--assign") + 1]
  : null;

async function snapshot(label: string) {
  const queued = await ccPrisma.$queryRaw`
    SELECT c.id, c.subject, c.status, c.queue_id, q.name AS queue_name
    FROM ccass.conversations c
    LEFT JOIN ccass.queues q ON q.id = c.queue_id
    WHERE c.organization_id = ${ORG}::bigint
      AND c.channel = 'email'
      AND c.status = 'queued'
      AND c.assigned_agent_id IS NULL
    ORDER BY c.priority DESC, c.queued_at ASC NULLS LAST
  `;

  const agents = await ccPrisma.$queryRaw`
    SELECT u.work_email, ap.presence_state,
           ac.active_count AS email_active, ac.max_concurrency AS email_max
    FROM ccass.agents a
    JOIN accounts.setup_users u ON u.id = a.setup_user_id
    LEFT JOIN ccass.agent_presence ap ON ap.agent_id = a.id
    LEFT JOIN ccass.agent_capacity ac ON ac.agent_id = a.id AND ac.channel = 'email'
    WHERE u.organization_id = ${ORG}::bigint
      AND EXISTS (
        SELECT 1 FROM ccass.queue_members qm
        WHERE qm.agent_id = a.id AND qm.handles_email = TRUE
      )
  `;

  console.log(`\n=== ${label} ===`);
  console.log(JSON.stringify({ queued, agents }, (_k, v) => (typeof v === "bigint" ? Number(v) : v), 2));
}

async function main() {
  await ccPrisma.$executeRaw`SELECT set_config('app.is_staff', 'true', true)`;
  await ccPrisma.$executeRaw`SELECT set_config('app.organization_id', ${ORG}, true)`;

  await snapshot("Before");

  if (!assignEmail) {
    console.log("\nTip: pass --assign agent.test@worktual.local to simulate availability drain.");
    return;
  }

  const agentRows = await ccPrisma.$queryRaw<Array<{ agent_id: string }>>`
    SELECT a.id AS agent_id
    FROM ccass.agents a
    JOIN accounts.setup_users u ON u.id = a.setup_user_id
    WHERE u.organization_id = ${ORG}::bigint AND lower(u.work_email) = lower(${assignEmail})
    LIMIT 1
  `;
  const agentId = agentRows[0]?.agent_id;
  if (!agentId) {
    console.error(`Agent not found: ${assignEmail}`);
    process.exit(1);
  }

  const result = await ccPrisma.$transaction(async (db) => {
    await db.$executeRaw`SELECT set_config('app.is_staff', 'true', true)`;
    await db.$executeRaw`SELECT set_config('app.organization_id', ${ORG}, true)`;
    await setAgentPresenceByAgentId(db, ORG, agentId, "busy", {
      source: "routing_availability_test",
    });
    return routeOldestQueuedConversationForAgent(db, ORG, agentId, {
      reason: "routing_availability_test",
    });
  });

  console.log("\nDrain result:", result ? {
    conversationId: result.conversation.id,
    subject: result.conversation.subject,
    status: result.conversation.status,
    assignedUserId: result.userId,
  } : null);

  await snapshot("After");
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => ccPrisma.$disconnect());
