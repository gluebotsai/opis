import "@ai-contact-center/config/load-root-env";
import { ccPrisma } from "@ai-contact-center/db-cc";

import { consolidateDuplicateOpenCallbacks } from "../src/services/callback-task-dedupe.js";

const ORG = process.env.ORGANIZATION_ID ?? "1000";
const dryRun = process.argv.includes("--dry-run");

async function main(): Promise<void> {
  await ccPrisma.$executeRaw`SELECT set_config('app.is_staff', 'true', true)`;
  await ccPrisma.$executeRaw`SELECT set_config('app.organization_id', ${ORG}, true)`;

  const before = await ccPrisma.$queryRaw<
    Array<{ id: string; contact_id: string | null; conversation_id: string | null; status: string }>
  >`
    SELECT t.id::text AS id,
           t.contact_id::text,
           t.conversation_id::text,
           t.status
    FROM ccass.agent_tasks t
    WHERE t.organization_id = ${ORG}::bigint
      AND t.task_type = 'callback'
      AND t.status = 'open'
    ORDER BY t.conversation_id NULLS LAST, t.updated_at DESC
  `;

  console.log(`Open callback tasks before: ${before.length}`);

  if (dryRun) {
    const duplicateGroups = await ccPrisma.$queryRaw<
      Array<{ conversation_id: string | null; open_count: number; task_ids: string }>
    >`
      SELECT
        t.conversation_id::text AS conversation_id,
        COUNT(*)::int AS open_count,
        string_agg(t.id::text, ', ' ORDER BY t.updated_at DESC) AS task_ids
      FROM ccass.agent_tasks t
      WHERE t.organization_id = ${ORG}::bigint
        AND t.task_type = 'callback'
        AND t.status = 'open'
        AND t.conversation_id IS NOT NULL
      GROUP BY t.conversation_id
      HAVING COUNT(*) > 1
      ORDER BY open_count DESC
    `;
    console.log("Duplicate open callbacks by conversation:");
    console.log(JSON.stringify(duplicateGroups, null, 2));
    return;
  }

  const dismissed = await consolidateDuplicateOpenCallbacks(ccPrisma, ORG);
  console.log(`Dismissed duplicate open callbacks: ${dismissed}`);

  const after = await ccPrisma.$queryRaw<
    Array<{ id: string; contact_id: string | null; conversation_id: string | null }>
  >`
    SELECT t.id::text AS id,
           t.contact_id::text,
           t.conversation_id::text
    FROM ccass.agent_tasks t
    WHERE t.organization_id = ${ORG}::bigint
      AND t.task_type = 'callback'
      AND t.status = 'open'
    ORDER BY t.updated_at DESC
  `;
  console.log(`Open callback tasks after: ${after.length}`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await ccPrisma.$disconnect();
  });
