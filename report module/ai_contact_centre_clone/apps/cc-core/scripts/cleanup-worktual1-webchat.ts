/**
 * Reset stale webchat test state: resolve stuck conversations and free agent capacity.
 * Usage: npx tsx apps/cc-core/scripts/cleanup-worktual1-webchat.ts --live
 */
import "@ai-contact-center/config/load-root-env";
import { ccPrisma } from "@ai-contact-center/db-cc";

const ORG_ID = process.env.ORGANIZATION_ID ?? "1000";
const live = process.argv.includes("--live");

function serializeForJson(value: unknown): unknown {
  if (typeof value === "bigint") return value.toString();
  if (Array.isArray(value)) return value.map(serializeForJson);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([key, entry]) => [
        key,
        serializeForJson(entry),
      ]),
    );
  }
  return value;
}

async function main() {
  await ccPrisma.$executeRaw`SELECT set_config('app.is_staff', 'true', true)`;
  await ccPrisma.$executeRaw`SELECT set_config('app.organization_id', ${ORG_ID}, true)`;

  const stuck = await ccPrisma.$queryRaw<
    Array<{ id: string; status: string; assigned_agent_id: string | null }>
  >`
    SELECT id, status, assigned_agent_id
    FROM ccass.conversations
    WHERE organization_id = ${ORG_ID}::bigint
      AND channel = 'webchat'
      AND status IN ('active', 'assigned', 'queued', 'bot_active')
    ORDER BY updated_at DESC
  `;

  const capacity = await ccPrisma.$queryRaw<
    Array<{ email: string; active_count: number; reserved_count: number; max_concurrency: number }>
  >`
    SELECT u.work_email AS email, ac.active_count, ac.reserved_count, ac.max_concurrency
    FROM ccass.agent_capacity ac
    JOIN ccass.agents a ON a.id = ac.agent_id
    JOIN accounts.setup_users u ON u.id = a.setup_user_id
    WHERE a.organization_id = ${ORG_ID}::bigint
      AND ac.channel = 'chat'
  `;

  console.log(
    JSON.stringify(
      serializeForJson({
        organizationId: ORG_ID,
        live,
        stuckWebchatCount: stuck.length,
        stuckSample: stuck.slice(0, 8),
        chatCapacity: capacity,
      }),
      null,
      2,
    ),
  );

  if (!live) {
    console.log("\nDry run only. Re-run with --live to resolve stuck webchat conversations.");
    return;
  }

  const conversationIds = stuck.map((row) => String(row.id));
  if (conversationIds.length === 0) {
    console.log("No stuck webchat conversations.");
  } else {
    await ccPrisma.$transaction(async (db) => {
      await db.$executeRaw`SELECT set_config('app.is_staff', 'true', true)`;
      await db.$executeRaw`SELECT set_config('app.organization_id', ${ORG_ID}, true)`;

      await db.$executeRaw`
        UPDATE ccass.conversation_assignments
        SET state = 'ended', ended_at = NOW(), reason = 'test_cleanup'
        WHERE organization_id = ${ORG_ID}::bigint
          AND conversation_id = ANY(${conversationIds}::bigint[])
          AND state IN ('offered', 'accepted')
      `;

      await db.$executeRaw`
        UPDATE ccass.conversations
        SET
          status = 'resolved',
          lifecycle_state = 'ended',
          bot_active = FALSE,
          resolved_at = COALESCE(resolved_at, NOW()),
          ended_at = NOW(),
          end_reason = 'test_cleanup',
          end_actor = 'system',
          updated_at = NOW()
        WHERE organization_id = ${ORG_ID}::bigint
          AND id = ANY(${conversationIds}::bigint[])
      `;
    });
  }

  await ccPrisma.$executeRaw`
    UPDATE ccass.agent_capacity ac
    SET active_count = 0,
        reserved_count = 0,
        updated_at = NOW()
    FROM ccass.agents a
    WHERE ac.agent_id = a.id
      AND a.organization_id = ${ORG_ID}::bigint
      AND ac.channel = 'chat'
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
