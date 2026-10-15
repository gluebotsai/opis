/**
 * CRM rows in accounts.auth_sessions — one active login per product (product_id = crm).
 */

import { randomBytes } from "node:crypto";
import type { PoolClient, QueryResult, QueryResultRow } from "pg";
import { accountQuery, withAccountTransaction } from "@/dao/db/account-pool";

export const CRM_AUTH_PRODUCT_ID = "crm";

/** Non-remember browser session. */
export const CRM_SESSION_TTL_SECONDS = Number(
  process.env.CRM_SESSION_TTL_SECONDS || 60 * 60 * 12,
);

/** Remember-me session (matches login cookie maxAge). */
export const CRM_SESSION_REMEMBER_TTL_SECONDS = Number(
  process.env.CRM_SESSION_REMEMBER_TTL_SECONDS || 60 * 60 * 24 * 30,
);

export type AuthSessionRow = {
  token: string;
  email: string;
  role: string;
  display_name: string | null;
  expires_at: Date;
  user_id: string | null;
  product_id: string | null;
};

function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

type Queryable = {
  query: <T extends QueryResultRow>(
    text: string,
    params?: unknown[],
  ) => Promise<QueryResult<T>>;
};

async function runQuery<T extends QueryResultRow>(
  client: Queryable | undefined,
  text: string,
  params: unknown[] = [],
) {
  if (client) return client.query<T>(text, params);
  return accountQuery<T>(text, params);
}

export function mintAuthSessionToken(): string {
  return randomBytes(32).toString("hex");
}

export async function findActiveCrmSessionByEmail(
  email: string,
  client?: Queryable,
): Promise<AuthSessionRow | null> {
  const normalized = normalizeEmail(email);
  if (!normalized) return null;
  const { rows } = await runQuery<AuthSessionRow>(
    client,
    `SELECT token, email, role, display_name, expires_at, user_id::text AS user_id, product_id
     FROM accounts.auth_sessions
     WHERE lower(email) = lower($1)
       AND expires_at > now()
       AND product_id = $2
     ORDER BY expires_at DESC
     LIMIT 1`,
    [normalized, CRM_AUTH_PRODUCT_ID],
  );
  return rows[0] ?? null;
}

export async function deleteCrmSessionsForEmail(
  email: string,
  client?: Queryable,
): Promise<number> {
  const normalized = normalizeEmail(email);
  if (!normalized) return 0;
  const { rowCount } = await runQuery(
    client,
    `DELETE FROM accounts.auth_sessions
     WHERE lower(email) = lower($1)
       AND product_id = $2`,
    [normalized, CRM_AUTH_PRODUCT_ID],
  );
  return rowCount ?? 0;
}

export async function deleteCrmSessionByToken(token: string): Promise<void> {
  const value = token.trim();
  if (!value) return;
  await accountQuery(
    `DELETE FROM accounts.auth_sessions
     WHERE token = $1
       AND product_id = $2`,
    [value, CRM_AUTH_PRODUCT_ID],
  );
}

export async function insertCrmAuthSession(
  input: {
    token: string;
    email: string;
    role: string;
    displayName: string;
    userId: string;
    expiresAt: Date;
  },
  client?: Queryable,
): Promise<void> {
  await runQuery(
    client,
    `INSERT INTO accounts.auth_sessions (
       token, email, role, display_name, expires_at, user_id, presence_initialized_at, product_id
     ) VALUES (
       $1, $2, $3, $4, $5, $6::bigint, NULL, $7
     )`,
    [
      input.token,
      normalizeEmail(input.email),
      input.role,
      input.displayName,
      input.expiresAt,
      input.userId,
      CRM_AUTH_PRODUCT_ID,
    ],
  );
}

export class CrmSessionActiveElsewhereError extends Error {
  readonly code = "session_active_elsewhere";
  constructor() {
    super("You are already signed in to CRM in another browser or tab.");
    this.name = "CrmSessionActiveElsewhereError";
  }
}

/**
 * One CRM session per email. Same cookie may refresh in place.
 * Force deletes the previous CRM row, then inserts this login.
 */
export async function establishCrmLoginSession(input: {
  email: string;
  role: string;
  displayName: string;
  userId: string;
  expiresAt: Date;
  force: boolean;
  currentCookieToken?: string | null;
}): Promise<{ token: string; replaced: boolean }> {
  return withAccountTransaction(async (client: PoolClient) => {
    const existing = await findActiveCrmSessionByEmail(input.email, client);
    const cookie = input.currentCookieToken?.trim() || "";
    const sameBrowser = Boolean(existing && cookie && existing.token === cookie);

    if (existing && !input.force && !sameBrowser) {
      throw new CrmSessionActiveElsewhereError();
    }

    const replaced = Boolean(existing && !sameBrowser);
    await deleteCrmSessionsForEmail(input.email, client);

    const token = mintAuthSessionToken();
    await insertCrmAuthSession(
      {
        token,
        email: input.email,
        role: input.role,
        displayName: input.displayName,
        userId: input.userId,
        expiresAt: input.expiresAt,
      },
      client,
    );
    return { token, replaced };
  });
}

export async function findValidCrmSessionByToken(
  token: string,
): Promise<AuthSessionRow | null> {
  const value = token.trim();
  if (!value) return null;
  const { rows } = await accountQuery<AuthSessionRow>(
    `SELECT token, email, role, display_name, expires_at, user_id::text AS user_id, product_id
     FROM accounts.auth_sessions
     WHERE token = $1
       AND expires_at > now()
       AND product_id = $2
     LIMIT 1`,
    [value, CRM_AUTH_PRODUCT_ID],
  );
  return rows[0] ?? null;
}

export function sessionExpiresAt(remember: boolean): Date {
  const seconds = remember
    ? CRM_SESSION_REMEMBER_TTL_SECONDS
    : CRM_SESSION_TTL_SECONDS;
  return new Date(Date.now() + seconds * 1000);
}
