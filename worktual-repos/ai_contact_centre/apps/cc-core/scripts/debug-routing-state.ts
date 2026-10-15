/**
 * Debug routing eligibility for webchat queue.
 * Usage: npx tsx apps/cc-core/scripts/debug-routing-state.ts
 */
import "@ai-contact-center/config/load-root-env";
import { ccPrisma } from "@ai-contact-center/db-cc";
import { isRedisEnabled } from "../src/lib/redis-client.js";
import { routeConversationToAgent } from "../src/services/routing.js";

const ORG_ID = "ce4ff326-4c0e-43f2-a978-e6b494cd0775";
const QUEUE_ID = "81019f3d-826b-498f-8273-18abe4df6dba";

async function main() {
  console.log("redis enabled:", isRedisEnabled());

  const members = await ccPrisma.$queryRaw<
    Array<{
      email: string;
      agent_id: string;
      handles_chat: boolean;
      chat_concurrency: number;
      presence_state: string | null;
      ap_status: string | null;
      active_count: number | null;
      reserved_count: number | null;
      max_concurrency: number | null;
    }>
  >`
    SELECT u.work_email AS email, qm.agent_id, qm.handles_chat, qm.chat_concurrency,
      ap.presence_state, ap.status AS ap_status,
      ac.active_count, ac.reserved_count, ac.max_concurrency
    FROM ccass.queue_members qm
    JOIN ccass.agents a ON a.id = qm.agent_id
    JOIN accounts.setup_users u ON u.id = a.setup_user_id
    LEFT JOIN ccass.agent_presence ap ON ap.agent_id = qm.agent_id
    LEFT JOIN ccass.agent_capacity ac ON ac.agent_id = qm.agent_id AND ac.channel = 'chat'
    WHERE qm.queue_id = ${QUEUE_ID}::bigint
  `;
  console.log("\nqueue members:");
  console.table(members);

  const queued = await ccPrisma.$queryRaw<
    Array<{ id: string; status: string; queued_at: Date | null }>
  >`
    SELECT id, status, queued_at
    FROM ccass.conversations
    WHERE organization_id = ${ORG_ID}::bigint
      AND channel = 'webchat'
      AND status = 'queued'
    ORDER BY queued_at ASC NULLS LAST
    LIMIT 5
  `;
  console.log("\noldest queued webchat conversations:");
  console.table(queued);

  if (queued[0]) {
    const routed = await routeConversationToAgent(
      ccPrisma,
      ORG_ID,
      queued[0].id,
      QUEUE_ID,
      { reason: "debug-script", channel: "chat" },
    );
    console.log("\nroute attempt for", queued[0].id, routed);
  }

  const outcomes = await ccPrisma.$queryRaw<Array<{ outcome: string; cnt: number }>>`
    SELECT outcome, COUNT(*)::int AS cnt
    FROM ccass.routing_attempts
    WHERE organization_id = ${ORG_ID}::bigint
    GROUP BY outcome
    ORDER BY cnt DESC
    LIMIT 10
  `;
  console.log("\nrouting attempt outcomes:");
  console.table(outcomes);
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await ccPrisma.$disconnect();
  });
