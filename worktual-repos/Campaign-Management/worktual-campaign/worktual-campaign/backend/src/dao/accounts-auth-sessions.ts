import { createHash } from "node:crypto";
import { accountQuery } from "../plugins/account-pool.js";
import { RESPONSE } from "../helpers/constants.js";
import { AppError } from "../helpers/response-builders.js";

/** accounts.auth_sessions token columns are often varchar(128); JWTs are longer. */
const AUTH_SESSION_TOKEN_MAX = 128;

function tokenForAuthSessionColumn(token: string): string {
  const t = token.trim();
  if (!t) return "";
  if (t.length <= AUTH_SESSION_TOKEN_MAX) return t;
  return createHash("sha256").update(t).digest("hex");
}

/** Same key as accounts.setup_user_product_access for Campaign. */
export const CAMPAIGN_AUTH_PRODUCT_ID = "campaign";

let columnCache: Set<string> | null | undefined;

async function authSessionColumns(): Promise<Set<string> | null> {
  if (columnCache !== undefined) return columnCache;
  try {
    const { rows } = await accountQuery<{ column_name: string }>(
      `SELECT column_name
       FROM information_schema.columns
       WHERE table_schema = 'accounts'
         AND table_name = 'auth_sessions'`,
    );
    if (!rows.length) {
      columnCache = null;
      return null;
    }
    columnCache = new Set(rows.map((r) => String(r.column_name).toLowerCase()));
    return columnCache;
  } catch (err) {
    console.warn(
      "[auth-sessions] could not inspect accounts.auth_sessions:",
      err instanceof Error ? err.message : err,
    );
    columnCache = null;
    return null;
  }
}

function hasCols(cols: Set<string>, ...names: string[]): boolean {
  return names.every((n) => cols.has(n));
}

export function resetAuthSessionColumnCache(): void {
  columnCache = undefined;
}

/** True when this email already has a live Campaign row (other products ignored). */
export async function hasActiveCampaignAuthSession(
  email: string,
): Promise<boolean> {
  const cols = await authSessionColumns();
  if (!cols || !hasCols(cols, "email", "product_id")) return false;
  const addr = email.trim().toLowerCase();
  if (!addr) return false;
  const expiry = cols.has("expires_at")
    ? " AND expires_at > now()"
    : "";
  const { rows } = await accountQuery<{ ok: number }>(
    `SELECT 1 AS ok
     FROM accounts.auth_sessions
     WHERE lower(email) = lower($1)
       AND product_id = $2${expiry}
     LIMIT 1`,
    [addr, CAMPAIGN_AUTH_PRODUCT_ID],
  );
  return rows.length > 0;
}

export async function assertCampaignAuthSessionAvailable(
  email: string,
): Promise<void> {
  if (await hasActiveCampaignAuthSession(email)) {
    throw new AppError(
      RESPONSE.campaign_session_active,
      409,
      "CAMPAIGN_SESSION_ACTIVE",
    );
  }
}

export async function insertCampaignAuthSession(input: {
  email: string;
  userId: string;
  token?: string;
  expiresAt: Date;
}): Promise<void> {
  const cols = await authSessionColumns();
  if (!cols || !hasCols(cols, "email", "product_id")) return;

  const names: string[] = [];
  const values: unknown[] = [];
  const push = (column: string, value: unknown) => {
    if (!cols.has(column)) return;
    names.push(column);
    values.push(value);
  };

  push("email", input.email.trim().toLowerCase());
  push("product_id", CAMPAIGN_AUTH_PRODUCT_ID);
  push("expires_at", input.expiresAt);
  push("user_id", input.userId);
  const token = tokenForAuthSessionColumn(String(input.token || ""));
  if (token) {
    if (cols.has("token")) push("token", token);
    else if (cols.has("session_token")) push("session_token", token);
    else if (cols.has("access_token")) push("access_token", token);
  }
  const now = new Date();
  if (cols.has("created_at")) push("created_at", now);
  if (cols.has("updated_at")) push("updated_at", now);
  if (cols.has("is_active")) push("is_active", true);
  if (cols.has("status")) push("status", "active");

  if (!names.length) return;
  const placeholders = names.map((_, i) => `$${i + 1}`).join(", ");
  await accountQuery(
    `INSERT INTO accounts.auth_sessions (${names.join(", ")})
     VALUES (${placeholders})`,
    values,
  );
}

/** Logout / force sign-out — Campaign rows only. Never touch NULL or other products. */
export async function deleteCampaignAuthSessions(email: string): Promise<void> {
  const cols = await authSessionColumns();
  if (!cols || !hasCols(cols, "email", "product_id")) return;
  const addr = email.trim().toLowerCase();
  if (!addr) return;
  await accountQuery(
    `DELETE FROM accounts.auth_sessions
     WHERE lower(email) = lower($1)
       AND product_id = $2`,
    [addr, CAMPAIGN_AUTH_PRODUCT_ID],
  );
}

export function campaignAuthExpiresAt(remember?: boolean): Date {
  const days = remember ? 30 : 7;
  return new Date(Date.now() + days * 24 * 60 * 60 * 1000);
}
