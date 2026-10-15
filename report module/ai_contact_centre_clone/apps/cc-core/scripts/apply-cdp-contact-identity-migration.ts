import "@ai-contact-center/config/load-root-env";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { ccPrisma } from "@ai-contact-center/db-cc";

const migrationPath = join(
  dirname(fileURLToPath(import.meta.url)),
  "../../../packages/db-cc/prisma/migrations/cdp_contact_identity_v1.sql",
);

function stripLeadingComments(statement: string): string {
  return statement
    .split("\n")
    .filter((line) => !line.trim().startsWith("--"))
    .join("\n")
    .trim();
}

function splitSqlStatements(sql: string): string[] {
  const statements: string[] = [];
  let current = "";
  let depth = 0;
  for (const char of sql) {
    if (char === "(") depth += 1;
    if (char === ")" && depth > 0) depth -= 1;
    if (char === ";" && depth === 0) {
      const trimmed = stripLeadingComments(current);
      if (trimmed) statements.push(trimmed);
      current = "";
      continue;
    }
    current += char;
  }
  const trailing = stripLeadingComments(current);
  if (trailing) statements.push(trailing);
  return statements;
}

async function main() {
  const sql = readFileSync(migrationPath, "utf8");
  const statements = splitSqlStatements(sql);

  await ccPrisma.$transaction(async (db) => {
    await db.$executeRaw`SELECT set_config('app.is_staff', 'true', true)`;
    for (const statement of statements) {
      await db.$executeRawUnsafe(statement);
    }
  });

  console.log("Applied cdp_contact_identity_v1.sql");
}

main()
  .catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  })
  .finally(async () => {
    await ccPrisma.$disconnect();
  });
