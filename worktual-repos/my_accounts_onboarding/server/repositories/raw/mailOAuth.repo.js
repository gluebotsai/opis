import { query } from "../../db/pool.js";

function runnerQuery(runner) {
  if (typeof runner?.query === "function") {
    return runner;
  }
  return query;
}

const MAIL_OAUTH_CONNECTION_COLUMNS = `id, account_type, account_id, mailbox_profile, account_email, account_name,
  ms_tenant_id, access_token_encrypted, refresh_token_encrypted, expires_at, scope,
  created_at, updated_at`;

export async function selectMailOAuthConnection(accountType, accountId, mailboxProfile) {
  const { rows } = await query(
    `SELECT ${MAIL_OAUTH_CONNECTION_COLUMNS}
     FROM mail_oauth_connections
     WHERE account_type = $1 AND account_id = $2 AND mailbox_profile = $3`,
    [accountType || "internal", accountId, mailboxProfile],
  );
  return rows[0] || null;
}

export async function selectLatestProfileMailConnection(mailboxProfile) {
  const { rows } = await query(
    `SELECT ${MAIL_OAUTH_CONNECTION_COLUMNS}
     FROM mail_oauth_connections
     WHERE mailbox_profile = $1
     ORDER BY updated_at DESC
     LIMIT 1`,
    [mailboxProfile],
  );
  return rows[0] || null;
}

export async function upsertMailOAuthConnection(values) {
  await query(
    `INSERT INTO mail_oauth_connections (
       account_type, account_id, mailbox_profile, account_email, account_name, ms_tenant_id,
       access_token_encrypted, refresh_token_encrypted, expires_at, scope, updated_at
     )
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, NOW())
     ON CONFLICT (account_type, account_id, mailbox_profile)
     DO UPDATE SET
       account_email = EXCLUDED.account_email,
       account_name = EXCLUDED.account_name,
       ms_tenant_id = EXCLUDED.ms_tenant_id,
       access_token_encrypted = EXCLUDED.access_token_encrypted,
       refresh_token_encrypted = EXCLUDED.refresh_token_encrypted,
       expires_at = EXCLUDED.expires_at,
       scope = EXCLUDED.scope,
       updated_at = NOW()`,
    values,
  );
}

export async function deleteMailOAuthConnection(accountType, accountId, mailboxProfile) {
  await query(
    `DELETE FROM mail_oauth_connections
     WHERE account_type = $1 AND account_id = $2 AND mailbox_profile = $3`,
    [accountType || "internal", accountId, mailboxProfile],
  );
}

export async function insertOAuthState(values) {
  await query(
    `INSERT INTO mail_oauth_states (state, account_type, account_id, mailbox_profile, return_path, expires_at)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    values,
  );
}

export async function consumeOAuthState(state) {
  const { rows } = await query(
    `DELETE FROM mail_oauth_states
     WHERE state = $1 AND expires_at > NOW()
     RETURNING state, account_type, account_id, mailbox_profile, return_path`,
    [state],
  );
  return rows[0] || null;
}

export async function deleteExpiredOAuthStates() {
  await query(`DELETE FROM mail_oauth_states WHERE expires_at <= NOW()`);
}
