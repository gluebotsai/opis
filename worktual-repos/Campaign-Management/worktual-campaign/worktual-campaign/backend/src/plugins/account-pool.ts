import { Pool, type QueryResultRow } from "pg";
import { env } from "../config/env.js";

/**
 * my_account_qa pool — users (read for login) + contacts (read/write).
 * No DDL from Campaign MS; schema changes go through account SQL migrations.
 */

const globalForAccount = globalThis as unknown as {
  accountPool: Pool | undefined;
};

export const accountPool =
  globalForAccount.accountPool ??
  new Pool({
    connectionString: env.accountDatabaseUrl,
    // Keep low: shared account DB hits max_connections when many local API/agent
    // processes each open a large pool (surfaces as login bounce / 401).
    max: 5,
    idleTimeoutMillis: 15_000,
    connectionTimeoutMillis: 8_000,
    allowExitOnIdle: true,
  });

accountPool.on("error", (err) => {
  console.error("[account-pool] idle client error", err);
});

if (process.env.NODE_ENV !== "production") {
  globalForAccount.accountPool = accountPool;
}

const DEFAULT_STATEMENT_TIMEOUT_MS = 25_000;

export async function accountQuery<T extends QueryResultRow>(
  text: string,
  params: unknown[] = [],
  opts?: { timeoutMs?: number },
) {
  const timeoutMs = opts?.timeoutMs ?? DEFAULT_STATEMENT_TIMEOUT_MS;
  const client = await accountPool.connect();
  try {
    // Prefer a single statement with statement_timeout over BEGIN/COMMIT —
    // transactions held pool slots longer and amplified "too many clients".
    await client.query(`SET statement_timeout = ${Math.max(1, timeoutMs)}`);
    return await client.query<T>(text, params);
  } finally {
    try {
      await client.query("SET statement_timeout = 0");
    } catch {
      /* ignore */
    }
    client.release();
  }
}
