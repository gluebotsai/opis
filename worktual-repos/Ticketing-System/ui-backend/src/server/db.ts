import pg from "pg";

const { Pool } = pg;

/** Dev-only seed IDs — used only when SEED_DEMO=1. Never fall back to these for live requests. */
export const DEFAULT_ORG_ID = "1";
export const DEFAULT_ADMIN_ID = "2";

export function seedDemoEnabled(): boolean {
  const v = String(process.env.SEED_DEMO || "").trim().toLowerCase();
  return v === "1" || v === "true" || v === "yes";
}

function requireDatabaseUrl(): string {
  const url = String(process.env.DATABASE_URL || "").trim();
  if (url) return url;
  throw new Error("DATABASE_URL must be set");
}

const connectionString = requireDatabaseUrl();

/**
 * All app queries use search_path=ticketing so we never read/write other schemas
 * by accident. Bootstrap DDL additionally qualifies ticketing.* explicitly.
 */
export const pool = new Pool({
  connectionString,
  options: "-c search_path=ticketing",
  max: 20,
  connectionTimeoutMillis: 8_000,
  idleTimeoutMillis: 30_000,
});

export async function query<T extends pg.QueryResultRow = pg.QueryResultRow>(
  text: string,
  params?: unknown[]
) {
  return pool.query<T>(text, params);
}
