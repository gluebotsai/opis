/**
 * Apply crm.seo_* DDL when prisma migrate deploy is blocked.
 * Idempotent — safe to re-run.
 *
 * Usage: npx tsx --tsconfig tsconfig.json --env-file=../.env scripts/apply-seo-semrush-cache-migration.ts
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const SQL_PATHS = [
  "prisma/migrations/20260904210000_seo_semrush_cache/migration.sql",
  "prisma/migrations/20260910120000_digital_marketing_keywords_social/migration.sql",
];

async function tableExists(client: pg.Client, name: string): Promise<boolean> {
  const { rows } = await client.query<{ exists: boolean }>(
    `SELECT EXISTS (
      SELECT 1 FROM information_schema.tables
      WHERE table_schema = 'crm' AND table_name = $1
    ) AS exists`,
    [name],
  );
  return Boolean(rows[0]?.exists);
}

async function main() {
  const url = process.env.DATABASE_URL?.trim();
  if (!url) throw new Error("DATABASE_URL is required");
  const client = new pg.Client({ connectionString: url });
  await client.connect();
  try {
    if (
      (await tableExists(client, "seo_projects")) &&
      (await tableExists(client, "seo_tool_snapshots")) &&
      (await tableExists(client, "seo_generated_content")) &&
      (await tableExists(client, "seo_keyword_queries")) &&
      (await tableExists(client, "seo_social_posts"))
    ) {
      console.log("crm.seo_* digital marketing tables already exist — nothing to do.");
      return;
    }
    for (const rel of SQL_PATHS) {
      await client.query(readFileSync(path.join(ROOT, rel), "utf8"));
    }
    console.log("applied crm.seo_* Digital Marketing tables");
  } finally {
    await client.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
