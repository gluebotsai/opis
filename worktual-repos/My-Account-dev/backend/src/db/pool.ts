import "../config/load-env.js";
import pg from "pg";
import type {
  PoolClient,
  QueryConfigValues,
  QueryResult,
  QueryResultRow,
} from "pg";

import { applyTenantSessionGucs } from "./tenantContext.js";

const { Pool } = pg;

function normalizeDatabaseUrl(url: string | undefined = ""): string {
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


// nothing to commit 
const resolvedConnectionString =
  connectionString ||
  "postgresql://worktual:worktual_secret_change_me@localhost:5432/worktual_accounts";

export const pool = new Pool({
  connectionString: resolvedConnectionString,
  max: Number(process.env.DB_POOL_MAX || 20),
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 10_000,
});

async function prepareClientSession(client: PoolClient): Promise<void> {
  await client.query(`SET search_path TO accounts, platform, public`);
  try {
    await applyTenantSessionGucs(client);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (!/platform\.set_staff_mode|platform\.set_tenant|does not exist/i.test(message)) {
      throw error;
    }
  }
}

const nativeConnect = pool.connect.bind(pool);
pool.connect = (async () => {
  const client = await nativeConnect();
  try {
    await prepareClientSession(client);
  } catch (error) {
    client.release();
    throw error;
  }
  return client;
}) as typeof pool.connect;

const nativeQuery = pool.query.bind(pool);
pool.query = (async <T extends QueryResultRow = QueryResultRow>(
  text: string,
  params?: QueryConfigValues<unknown[]>,
): Promise<QueryResult<T>> => {
  const client = await pool.connect();
  try {
    // prepareClientSession already ran in connect wrapper
    return await client.query<T>(text, params);
  } finally {
    client.release();
  }
}) as typeof pool.query;

/** True when Postgres is unreachable, starting up, or refusing connections. */
export function isDatabaseConnectivityError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /timeout exceeded when trying to connect|recovery mode|the database system is starting|the database system is not yet accepting connections|connection terminated unexpectedly|ECONNREFUSED|ETIMEDOUT|ENOTFOUND|getaddrinfo/i.test(
    message,
  );
}

/** True when a query references a table/relation that is not installed yet. */
export function isMissingDatabaseObjectError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  const code = (error as { code?: string } | null)?.code;
  return code === "42P01" || /relation .* does not exist/i.test(message);
}

export async function withTransaction<T>(
  callback: (client: PoolClient) => Promise<T>,
): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const result = await callback(client);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    try {
      await client.query("ROLLBACK");
    } catch {
      // ignore rollback errors
    }
    throw error;
  } finally {
    client.release();
  }
}

export async function query<T extends QueryResultRow = Record<string, unknown>>(
  text: string,
  params: QueryConfigValues<unknown[]> = [],
): Promise<QueryResult<T>> {
  return pool.query<T>(text, params);
}
