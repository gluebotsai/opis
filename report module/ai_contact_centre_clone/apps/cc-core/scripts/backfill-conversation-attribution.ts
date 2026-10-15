/**
 * Backfill assigned_user_id / assigned_at from conversation_assignments.
 * Usage: npx tsx apps/cc-core/scripts/backfill-conversation-attribution.ts [--org 1000]
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import "@ai-contact-center/config/load-root-env";
import { ccPrisma } from "@ai-contact-center/db-cc";

const orgArg = process.argv.find((arg) => arg.startsWith("--org="))?.split("=")[1];
const ORG_ID = orgArg ?? process.env.ORGANIZATION_ID ?? "1000";

async function main() {
  const migrationPath = join(
    dirname(fileURLToPath(import.meta.url)),
    "../../../packages/db-cc/prisma/migrations/conversation_assignment_attribution_backfill_v1.sql",
  );
  const sql = readFileSync(migrationPath, "utf8");

  await ccPrisma.$executeRaw`SELECT set_config('app.is_staff', 'true', true)`;
  await ccPrisma.$executeRaw`SELECT set_config('app.organization_id', ${ORG_ID}, true)`;

  const before = await ccPrisma.$queryRaw<
    Array<{ missing_user: bigint; missing_assigned_at: bigint }>
  >`
    SELECT
      COUNT(*) FILTER (WHERE assigned_user_id IS NULL AND status IN ('resolved', 'closed'))::bigint AS missing_user,
      COUNT(*) FILTER (WHERE assigned_at IS NULL AND status IN ('resolved', 'closed'))::bigint AS missing_assigned_at
    FROM ccass.conversations
    WHERE organization_id = ${ORG_ID}::bigint
  `;

  const statements = sql
    .split(";")
    .map((statement) => statement.trim())
    .filter(Boolean);

  for (const statement of statements) {
    await ccPrisma.$executeRawUnsafe(statement);
  }

  const after = await ccPrisma.$queryRaw<
    Array<{ missing_user: bigint; missing_assigned_at: bigint; handled_3d: bigint }>
  >`
    SELECT
      COUNT(*) FILTER (WHERE assigned_user_id IS NULL AND status IN ('resolved', 'closed'))::bigint AS missing_user,
      COUNT(*) FILTER (WHERE assigned_at IS NULL AND status IN ('resolved', 'closed'))::bigint AS missing_assigned_at,
      COUNT(*) FILTER (
        WHERE COALESCE(assigned_at, resolved_at, ended_at, created_at) >= NOW() - INTERVAL '3 days'
          AND (status IN ('resolved', 'closed') OR ended_at IS NOT NULL)
      )::bigint AS handled_3d
    FROM ccass.conversations
    WHERE organization_id = ${ORG_ID}::bigint
  `;

  console.log(
    JSON.stringify(
      {
        organizationId: ORG_ID,
        before: before[0],
        after: after[0],
      },
      (_key, value) => (typeof value === "bigint" ? value.toString() : value),
      2,
    ),
  );
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(() => ccPrisma.$disconnect());
