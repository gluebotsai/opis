import { Pool, type QueryResultRow } from "pg";

/**
 * my_account_qa pool — auth (users) only for Campaign MS.
 * Do not create campaign tables in this database.
 */

const globalForAccount = globalThis as unknown as {
  accountPool: Pool | undefined;
};

function accountDatabaseUrl() {
  const url = process.env.ACCOUNT_DATABASE_URL;
  if (!url) {
    throw new Error("ACCOUNT_DATABASE_URL is not set (expected my_account_qa).");
  }
  return url;
}

export const accountPool =
  globalForAccount.accountPool ??
  new Pool({
    connectionString: accountDatabaseUrl(),
  });

if (process.env.NODE_ENV !== "production") {
  globalForAccount.accountPool = accountPool;
}

export async function accountQuery<T extends QueryResultRow>(
  text: string,
  params: unknown[] = [],
) {
  return accountPool.query<T>(text, params);
}
