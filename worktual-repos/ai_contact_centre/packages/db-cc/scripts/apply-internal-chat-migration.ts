#!/usr/bin/env npx tsx
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import "@ai-contact-center/config/load-root-env";

import { PrismaClient } from "../src/generated/index.js";

const MIGRATION_NAME = "internal_chat_v1.sql";
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

    const tables = await db.$queryRaw<{ table_name: string }[]>`
      SELECT table_name
      FROM information_schema.tables
      WHERE table_schema = 'ccass' AND table_name LIKE 'internal_chat%'
      ORDER BY table_name
    `;
    console.log(`Created tables: ${tables.map((row) => row.table_name).join(", ")}`);
  } finally {
    await db.$disconnect();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
