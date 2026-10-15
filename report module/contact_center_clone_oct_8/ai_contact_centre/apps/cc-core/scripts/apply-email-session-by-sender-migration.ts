import "@ai-contact-center/config/load-root-env";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { ccPrisma } from "@ai-contact-center/db-cc";

const migrationPath = join(
  dirname(fileURLToPath(import.meta.url)),
  "../../../packages/db-cc/prisma/migrations/email_session_by_sender_v1.sql",
);

async function main() {
  const sql = readFileSync(migrationPath, "utf8");
  const statements = sql
    .split(";")
    .map((statement) => statement.trim())
    .filter((statement) => statement.length > 0 && !statement.startsWith("--"));

  for (const statement of statements) {
    await ccPrisma.$executeRawUnsafe(statement);
  }

  const { execSync } = await import("node:child_process");
  execSync("npx tsx scripts/dedupe-open-email-sessions.ts --live", {
    cwd: dirname(fileURLToPath(import.meta.url)) + "/..",
    stdio: "inherit",
  });

  await ccPrisma.$executeRawUnsafe(`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_ccass_conversations_open_email_sender_unique
      ON ccass.conversations (organization_id, lower(visitor_id), COALESCE(mailbox_connection_id, '00000000-0000-0000-0000-000000000000'::bigint))
      WHERE channel = 'email'
        AND visitor_id IS NOT NULL
        AND status NOT IN ('resolved', 'closed')
  `);

  console.log("Applied email_session_by_sender_v1.sql");
}

main()
  .catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  })
  .finally(async () => {
    await ccPrisma.$disconnect();
  });
