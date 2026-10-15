#!/usr/bin/env npx tsx
/**
 * Ordered, idempotent, fail-fast SQL migration runner for db-cc.
 *
 * Usage:
 *   npx tsx packages/db-cc/src/migrate.ts           # apply pending migrations
 *   npx tsx packages/db-cc/src/migrate.ts --status  # show applied/pending
 *   npx tsx packages/db-cc/src/migrate.ts --seed    # apply test seeds (non-prod)
 */
import { createHash } from "node:crypto";
import { readFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import "@ai-contact-center/config/load-root-env";

import { PrismaClient } from "./generated/index.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_DIR = join(__dirname, "..", "prisma", "migrations");
const SEEDS_DIR = join(__dirname, "..", "prisma", "seeds");
const MANIFEST_PATH = join(MIGRATIONS_DIR, "manifest.json");

type Manifest = {
  version: number;
  migrations: string[];
  seeds?: string[];
};

type MigrationRow = {
  name: string;
  checksum: string;
  applied_at: Date;
};

function loadManifest(): Manifest {
  const raw = readFileSync(MANIFEST_PATH, "utf-8");
  return JSON.parse(raw) as Manifest;
}

function checksum(content: string): string {
  return createHash("sha256").update(content).digest("hex").slice(0, 16);
}

function readSqlFile(dir: string, name: string): string {
  const path = join(dir, name);
  if (!existsSync(path)) {
    throw new Error(`Migration file not found: ${path}`);
  }
  return readFileSync(path, "utf-8");
}

/** Split SQL into executable statements, respecting dollar-quoted blocks. */
function splitStatements(sql: string): string[] {
  const statements: string[] = [];
  let current = "";
  let inDollarQuote = false;

  for (const line of sql.split("\n")) {
    const trimmed = line.trim();
    if (trimmed.startsWith("--")) {
      continue;
    }

    if (!inDollarQuote && trimmed.includes("$$")) {
      const parts = trimmed.split("$$");
      if (parts.length >= 2) {
        inDollarQuote = parts.length % 2 === 0;
      }
    } else if (inDollarQuote && trimmed.includes("$$")) {
      inDollarQuote = false;
    }

    current += line + "\n";

    if (!inDollarQuote && trimmed.endsWith(";")) {
      const stmt = current.trim();
      if (stmt.length > 1) {
        statements.push(stmt);
      }
      current = "";
    }
  }

  const remainder = current.trim();
  if (remainder.length > 1) {
    statements.push(remainder);
  }

  return statements;
}

async function getAppliedMigrations(db: PrismaClient): Promise<Map<string, string>> {
  try {
    const rows = await db.$queryRaw<MigrationRow[]>`
      SELECT name, checksum, applied_at
      FROM ccass.schema_migrations
      ORDER BY id ASC
    `;
    return new Map(rows.map((r) => [r.name, r.checksum]));
  } catch {
    return new Map();
  }
}

async function applyMigration(
  db: PrismaClient,
  name: string,
  content: string,
  hash: string,
): Promise<void> {
  const statements = splitStatements(content);

  for (const stmt of statements) {
    await db.$executeRawUnsafe(stmt);
  }
  await db.$executeRaw`
    INSERT INTO ccass.schema_migrations (name, checksum)
    VALUES (${name}, ${hash})
    ON CONFLICT (name) DO NOTHING
  `;
}

async function runMigrations(db: PrismaClient, dryRun = false): Promise<{ applied: string[]; skipped: string[] }> {
  const manifest = loadManifest();
  const applied = await getAppliedMigrations(db);
  const newlyApplied: string[] = [];
  const skipped: string[] = [];

  for (const name of manifest.migrations) {
    const content = readSqlFile(MIGRATIONS_DIR, name);
    const hash = checksum(content);

    const existing = applied.get(name);
    if (existing) {
      if (existing !== hash) {
        throw new Error(
          `Migration checksum mismatch for "${name}": applied=${existing}, current=${hash}. ` +
            `Create a new migration instead of editing an applied one.`,
        );
      }
      skipped.push(name);
      continue;
    }

    if (dryRun) {
      console.log(`[dry-run] would apply: ${name}`);
      newlyApplied.push(name);
      continue;
    }

    console.log(`Applying migration: ${name}`);
    await applyMigration(db, name, content, hash);
    newlyApplied.push(name);
  }

  return { applied: newlyApplied, skipped };
}

async function runSeeds(db: PrismaClient): Promise<void> {
  if (process.env.NODE_ENV === "production") {
    throw new Error("Seeds cannot be applied in production");
  }

  const manifest = loadManifest();
  for (const name of manifest.seeds ?? []) {
    const content = readSqlFile(SEEDS_DIR, name);
    console.log(`Applying seed: ${name}`);
    const statements = splitStatements(content);
    for (const stmt of statements) {
      await db.$executeRawUnsafe(stmt);
    }
  }
}

async function showStatus(db: PrismaClient): Promise<void> {
  const manifest = loadManifest();
  const applied = await getAppliedMigrations(db);

  console.log("Migration status:\n");
  for (const name of manifest.migrations) {
    const hash = applied.get(name);
    const content = readSqlFile(MIGRATIONS_DIR, name);
    const current = checksum(content);
    if (!hash) {
      console.log(`  PENDING  ${name}`);
    } else if (hash !== current) {
      console.log(`  MISMATCH ${name} (applied=${hash}, current=${current})`);
    } else {
      console.log(`  APPLIED  ${name}`);
    }
  }
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const db = new PrismaClient();

  try {
    if (args.includes("--status")) {
      await showStatus(db);
      return;
    }

    if (args.includes("--seed")) {
      await runSeeds(db);
      return;
    }

    const dryRun = args.includes("--dry-run");
    const result = await runMigrations(db, dryRun);

    console.log(`\nMigrations complete: ${result.applied.length} applied, ${result.skipped.length} skipped`);
  } finally {
    await db.$disconnect();
  }
}

main().catch((err) => {
  console.error("Migration failed:", err instanceof Error ? err.message : err);
  process.exit(1);
});
