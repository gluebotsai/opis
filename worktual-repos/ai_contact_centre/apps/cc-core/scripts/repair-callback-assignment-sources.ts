import "@ai-contact-center/config/load-root-env";
import { ccPrisma } from "@ai-contact-center/db-cc";

const ORG = process.env.ORGANIZATION_ID ?? "1000";
const dryRun = process.argv.includes("--dry-run");

async function main(): Promise<void> {
  await ccPrisma.$executeRaw`SELECT set_config('app.is_staff', 'true', true)`;
  await ccPrisma.$executeRaw`SELECT set_config('app.organization_id', ${ORG}, true)`;

  const mismatched = await ccPrisma.$queryRaw<
    Array<{
      id: string;
      source: string;
      assigned_by_label: string | null;
      status: string;
    }>
  >`
    SELECT t.id::text AS id,
           t.source,
           t.assigned_by_label,
           t.status
    FROM ccass.agent_tasks t
    WHERE t.organization_id = ${ORG}::bigint
      AND t.task_type = 'callback'
      AND t.source = 'coworker'
      AND t.assigned_by_user_id IS NOT NULL
    ORDER BY t.updated_at DESC
  `;

  console.log(`Callback tasks with supervisor metadata but coworker source: ${mismatched.length}`);
  if (mismatched.length > 0) {
    console.log(JSON.stringify(mismatched, null, 2));
  }

  if (dryRun || mismatched.length === 0) {
    return;
  }

  const repaired = await ccPrisma.$executeRaw`
    UPDATE ccass.agent_tasks
    SET source = 'admin',
        updated_at = NOW()
    WHERE organization_id = ${ORG}::bigint
      AND task_type = 'callback'
      AND source = 'coworker'
      AND assigned_by_user_id IS NOT NULL
  `;

  console.log(`Repaired callback assignment sources: ${Number(repaired)}`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await ccPrisma.$disconnect();
  });
