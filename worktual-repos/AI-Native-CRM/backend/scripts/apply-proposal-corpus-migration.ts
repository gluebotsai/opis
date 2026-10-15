/**
 * Apply crm proposal corpus/playbook DDL when prisma migrate deploy is blocked
 * by an older failed migration. Idempotent — safe to re-run.
 *
 * Usage: npx tsx --tsconfig tsconfig.json --env-file=../.env scripts/apply-proposal-corpus-migration.ts
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const SQL_PATH = path.join(
  ROOT,
  "prisma/migrations/20260902210000_proposal_corpus_playbook/migration.sql",
);

async function tableExists(client: pg.Client): Promise<boolean> {
  const { rows } = await client.query<{ exists: boolean }>(
    `SELECT EXISTS (
      SELECT 1 FROM information_schema.tables
      WHERE table_schema = 'crm' AND table_name = 'proposal_corpus_batches'
    ) AS exists`,
  );
  return Boolean(rows[0]?.exists);
}

async function main() {
  const url = process.env.DATABASE_URL?.trim();
  if (!url) throw new Error("DATABASE_URL is required");
  const client = new pg.Client({ connectionString: url });
  await client.connect();
  try {
    if (await tableExists(client)) {
      console.log("crm.proposal_corpus_batches already exists — nothing to do.");
      return;
    }
    await client.query(readFileSync(SQL_PATH, "utf8"));
    if (!(await tableExists(client))) {
      throw new Error("Applied SQL but crm.proposal_corpus_batches is still missing.");
    }
    console.log("created crm.proposal_corpus_batches and related corpus/playbook tables.");
  } finally {
    await client.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
