#!/usr/bin/env npx tsx
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import "@ai-contact-center/config/load-root-env";

import { PrismaClient } from "../src/generated/index.js";

const MIGRATION_NAME = "warm_agent_transfer_v1.sql";
const __dirname = dirname(fileURLToPath(import.meta.url));
const sqlPath = join(__dirname, "..", "prisma", "migrations", MIGRATION_NAME);
const content = readFileSync(sqlPath, "utf-8");
const hash = createHash("sha256").update(content).digest("hex").slice(0, 16);

function splitStatements(sql: string): string[] {
  const statements: string[] = [];
  let current = "";
  let inDollarQuote = false;

  for (const line of sql.split("\n")) {
    const trimmed = line.trim();
    if (trimmed.startsWith("--")) continue;

    if (!inDollarQuote && trimmed.includes("$$")) {
      const parts = trimmed.split("$$");
      if (parts.length >= 2) inDollarQuote = parts.length % 2 === 0;
    } else if (inDollarQuote && trimmed.includes("$$")) {
      inDollarQuote = false;
    }

    current += `${line}\n`;

    if (!inDollarQuote && trimmed.endsWith(";")) {
      const stmt = current.trim();
      if (stmt.length > 1) statements.push(stmt);
      current = "";
    }
  }

  const remainder = current.trim();
  if (remainder.length > 1) statements.push(remainder);
  return statements;
}

async function main(): Promise<void> {
  const db = new PrismaClient();
  try {
    const existing = await db.$queryRaw<{ name: string }[]>`
      SELECT name FROM ccass.schema_migrations WHERE name = ${MIGRATION_NAME}
    `;
    if (existing.length > 0) {
      console.log(`${MIGRATION_NAME} already applied`);
      return;
    }

    console.log(`Applying ${MIGRATION_NAME}...`);
    for (const stmt of splitStatements(content)) {
      await db.$executeRawUnsafe(stmt);
    }

    await db.$executeRaw`
      INSERT INTO ccass.schema_migrations (name, checksum)
      VALUES (${MIGRATION_NAME}, ${hash})
    `;

    const columns = await db.$queryRaw<{ column_name: string }[]>`
      SELECT column_name
      FROM information_schema.columns
      WHERE table_schema = 'ccass'
        AND table_name = 'conversation_transfers'
        AND column_name IN (
          'accepted_agent_id',
          'accepted_user_id',
          'rejected_at',
          'expired_at',
          'outcome_reason',
          'channel'
        )
      ORDER BY column_name
    `;
    console.log(
      `Warm transfer columns present: ${columns.map((row) => row.column_name).join(", ")}`,
    );
  } finally {
    await db.$disconnect();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
