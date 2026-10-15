import { Pool, type PoolClient, type QueryResultRow } from "pg";

/**
 * Shared worktual pool — accounts.setup_users (auth) + cdp.customer_profile /
 * cdp.identity_keys (person identity) + cdp.products (catalog).
 * No DDL / no column changes on accounts or cdp.
 * CRM fields in worktual.crm (Prisma).
 */

const globalForAccount = globalThis as unknown as {
  accountPool: Pool | undefined;
  accountPoolUrl: string | undefined;
  accountPoolVerified: boolean | undefined;
};

function accountDatabaseUrl() {
  const url = process.env.ACCOUNT_DATABASE_URL?.trim();
  if (!url) {
    throw new Error(
      "ACCOUNT_DATABASE_URL is not set (expected worktual shared DB).",
    );
  }
  return url;
}

function redactUrl(url: string): string {
  return url.replace(/:([^:@/]+)@/, ":***@");
}

/** Keep account pool small so it cannot exhaust Postgres alongside Prisma. */
const ACCOUNT_POOL_MAX = Number(process.env.ACCOUNT_POOL_MAX || 5);

function getAccountPool(): Pool {
  const url = accountDatabaseUrl();
  if (globalForAccount.accountPool && globalForAccount.accountPoolUrl === url) {
    return globalForAccount.accountPool;
  }

  // Env changed (e.g. my_account_qa → worktual) — drop stale pool.
  if (globalForAccount.accountPool) {
    void globalForAccount.accountPool.end().catch(() => undefined);
  }

  const pool = new Pool({
    connectionString: url,
    max: ACCOUNT_POOL_MAX,
    idleTimeoutMillis: 20_000,
    connectionTimeoutMillis: 10_000,
  });
  pool.on("error", (err) => {
    console.error("[account-pool] idle client error (non-fatal)", err.message);
  });
  globalForAccount.accountPool = pool;
  globalForAccount.accountPoolUrl = url;
  globalForAccount.accountPoolVerified = false;
  return pool;
}

async function verifyAccountPoolOnce(pool: Pool): Promise<void> {
  if (globalForAccount.accountPoolVerified) return;
  globalForAccount.accountPoolVerified = true;
  try {
    const { rows } = await pool.query<{
      db: string;
      users: string | null;
      profiles: string | null;
      keys: string | null;
    }>(
      `SELECT current_database() AS db,
              to_regclass('accounts.setup_users')::text AS users,
              to_regclass('cdp.customer_profile')::text AS profiles,
              to_regclass('cdp.identity_keys')::text AS keys`,
    );
    const row = rows[0];
    console.info(
      `[account-pool] ${redactUrl(accountDatabaseUrl())} db=${row?.db} setup_users=${row?.users ?? "MISSING"} cdp.customer_profile=${row?.profiles ?? "MISSING"} cdp.identity_keys=${row?.keys ?? "MISSING"}`,
    );
    if (!row?.users) {
      console.error(
        "[account-pool] accounts.setup_users missing — ACCOUNT_DATABASE_URL must point at worktual (not my_account_qa)",
      );
    }
    if (!row?.profiles || !row?.keys) {
      console.error(
        "[account-pool] cdp.customer_profile / cdp.identity_keys missing — ACCOUNT_DATABASE_URL must point at worktual CDP",
      );
    }
  } catch (err) {
    console.error(
      "[account-pool] verify failed",
      err instanceof Error ? err.message : err,
    );
  }
}

export async function accountQuery<T extends QueryResultRow>(
  text: string,
  params: unknown[] = [],
) {
  const pool = getAccountPool();
  await verifyAccountPoolOnce(pool);
  return pool.query<T>(text, params);
}

/** Run work inside a single connection transaction on the account pool. */
export async function withAccountTransaction<T>(
  fn: (client: PoolClient) => Promise<T>,
): Promise<T> {
  const pool = getAccountPool();
  await verifyAccountPoolOnce(pool);
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const result = await fn(client);
    await client.query("COMMIT");
    return result;
  } catch (err) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw err;
  } finally {
    client.release();
  }
}
