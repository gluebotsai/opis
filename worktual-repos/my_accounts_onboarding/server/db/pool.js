import "../load-env.js";
import pg from "pg";

const { Pool } = pg;

function normalizeDatabaseUrl(url = "") {
  return String(url).replace("postgresql+psycopg://", "postgresql://");
}

const connectionString = normalizeDatabaseUrl(process.env.DATABASE_URL);

if (!connectionString) {
  if (process.env.INVOCATION_ID) {
    console.error(
      "[db] FATAL: DATABASE_URL is not set. Ensure shared/.env exists and run ./scripts/install-systemd.sh",
    );
    process.exit(1);
  }

  console.warn("[db] DATABASE_URL not set — using local dev default");
}

const resolvedConnectionString =
  connectionString ||
  "postgresql://worktual:worktual_secret_change_me@localhost:5432/worktual_accounts";

export const pool = new Pool({
  connectionString: resolvedConnectionString,
  max: Number(process.env.DB_POOL_MAX || 20),
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 10_000,
});

export async function withTransaction(callback) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const result = await callback(client);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

export async function query(text, params = []) {
  return pool.query(text, params);
}
