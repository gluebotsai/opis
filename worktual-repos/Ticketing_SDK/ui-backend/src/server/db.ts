import { existsSync } from "node:fs";
import pg from "pg";

const { Pool } = pg;

/** Dev-only seed IDs — used only when SEED_DEMO=1. Never fall back to these for live requests. */
export const DEFAULT_ORG_ID = "1";
export const DEFAULT_ADMIN_ID = "2";

export function seedDemoEnabled(): boolean {
  const v = String(process.env.SEED_DEMO || "").trim().toLowerCase();
  return v === "1" || v === "true" || v === "yes";
}

function runningInDocker(): boolean {
  return (
    process.env.TICKETING_IN_DOCKER === "1" || existsSync("/.dockerenv")
  );
}

/** localhost inside a container is the container, not host Postgres. */
function databaseUrlForProcess(raw: string): string {
  if (!runningInDocker()) return raw;
  try {
    const parsed = new URL(raw);
    if (parsed.hostname === "localhost" || parsed.hostname === "127.0.0.1") {
      parsed.hostname = String(
        process.env.PG_DOCKER_HOST || "host.docker.internal"
      ).trim() || "host.docker.internal";
      return parsed.toString();
    }
  } catch {
    /* keep raw */
  }
  return raw;
}

function requireDatabaseUrl(): string {
  const dockerUrl = String(process.env.DATABASE_URL_DOCKER || "").trim();
  if (runningInDocker() && dockerUrl) return dockerUrl;
  const url = String(process.env.DATABASE_URL || "").trim();
  if (url) return databaseUrlForProcess(url);
  throw new Error("DATABASE_URL must be set");
}

const connectionString = requireDatabaseUrl();
if (process.env.DATABASE_URL !== connectionString) {
  console.warn(
    "DATABASE_URL localhost is the container itself; connecting via",
    connectionString.replace(/:[^:@/]+@/, ":***@")
  );
  process.env.DATABASE_URL = connectionString;
}

function poolMax(): number {
  const raw = Number(process.env.PG_POOL_MAX || 4);
  if (!Number.isFinite(raw)) return 4;
  return Math.min(16, Math.max(2, Math.floor(raw)));
}

function isPoolSaturated(err: unknown): boolean {
  const row = err as { code?: string; message?: string };
  const message = String(row?.message || "");
  return (
    row?.code === "53300" ||
    /too many clients already/i.test(message) ||
    /timeout exceeded when trying to connect/i.test(message)
  );
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * All app queries use search_path=ticketing so we never read/write other schemas
 * by accident. Bootstrap DDL additionally qualifies ticketing.* explicitly.
 * Keep max modest: leftover --watch processes + agents + GUI clients share
 * Postgres max_connections (53300 if we open too many).
 */
export const pool = new Pool({
  connectionString,
  application_name: "ticketing-api",
  options: "-c search_path=ticketing -c application_name=ticketing-api",
  max: poolMax(),
  connectionTimeoutMillis: 8_000,
  idleTimeoutMillis: 8_000,
  allowExitOnIdle: true,
});

pool.on("error", (err) => {
  console.warn("pg pool client error:", err.message);
});

function ident(name: string): string {
  if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(name)) {
    throw new Error(`Invalid SQL identifier: ${name}`);
  }
  return name;
}

/** Catalog lookup only — does not take AccessExclusiveLock the way ALTER does. */
export async function columnExists(
  schema: string,
  table: string,
  column: string
): Promise<boolean> {
  const { rows } = await query<{ exists: boolean }>(
    `SELECT EXISTS (
       SELECT 1
         FROM information_schema.columns
        WHERE table_schema = $1
          AND table_name = $2
          AND column_name = $3
     ) AS exists`,
    [schema, table, column]
  );
  return Boolean(rows[0]?.exists);
}

/** Skip ALTER when the column is already present so startup cannot block behind pg_dump. */
export async function columnIsNullable(
  schema: string,
  table: string,
  column: string
): Promise<boolean | null> {
  const { rows } = await query<{ is_nullable: string }>(
    `SELECT is_nullable
       FROM information_schema.columns
      WHERE table_schema = $1
        AND table_name = $2
        AND column_name = $3`,
    [schema, table, column]
  );
  const raw = rows[0]?.is_nullable;
  if (raw === "YES") return true;
  if (raw === "NO") return false;
  return null;
}

export async function constraintDefinition(
  schema: string,
  table: string,
  name: string
): Promise<string | null> {
  const { rows } = await query<{ def: string }>(
    `SELECT pg_get_constraintdef(c.oid) AS def
       FROM pg_constraint c
       JOIN pg_class t ON t.oid = c.conrelid
       JOIN pg_namespace n ON n.oid = t.relnamespace
      WHERE n.nspname = $1
        AND t.relname = $2
        AND c.conname = $3`,
    [schema, table, name]
  );
  return rows[0]?.def ? String(rows[0].def) : null;
}

export async function ensureColumn(
  schema: string,
  table: string,
  column: string,
  sqlType: string
): Promise<void> {
  if (await columnExists(schema, table, column)) return;
  await query(
    `ALTER TABLE ${ident(schema)}.${ident(table)} ADD COLUMN IF NOT EXISTS ${ident(column)} ${sqlType}`
  );
}

export async function query<T extends pg.QueryResultRow = pg.QueryResultRow>(
  text: string,
  params?: unknown[]
) {
  let last: unknown;
  for (let attempt = 0; attempt < 4; attempt++) {
    try {
      return await pool.query<T>(text, params);
    } catch (err) {
      last = err;
      if (!isPoolSaturated(err) || attempt === 3) throw err;
      await sleep(250 * (attempt + 1));
    }
  }
  throw last;
}
