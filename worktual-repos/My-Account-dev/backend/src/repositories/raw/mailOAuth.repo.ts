import { query } from "../../db/pool.js";

function runnerQuery(runner: any) {
  if (typeof runner?.query === "function") {
    return runner;
  }
  return query;
}

const MAIL_OAUTH_CONNECTION_COLUMNS = `id, account_type, account_id, mailbox_profile, account_email, account_name,
  ms_tenant_id, access_token_encrypted, refresh_token_encrypted, expires_at, scope,
  COALESCE(needs_reauth, FALSE) AS needs_reauth,
  created_at, updated_at`;

export async function selectMailOAuthConnection(accountType: any, accountId: any, mailboxProfile: any) {
  const { rows } = await query(
    `SELECT ${MAIL_OAUTH_CONNECTION_COLUMNS}
     FROM mail_oauth_connections
     WHERE account_type = $1 AND account_id = $2 AND mailbox_profile = $3`,
    [accountType || "internal", accountId, mailboxProfile],
  );
  return rows[0] || null;
}

export async function selectLatestProfileMailConnection(mailboxProfile: any) {
  const { rows } = await query(
    `SELECT ${MAIL_OAUTH_CONNECTION_COLUMNS}
     FROM mail_oauth_connections
     WHERE mailbox_profile = $1
       AND COALESCE(needs_reauth, FALSE) = FALSE
     ORDER BY updated_at DESC
     LIMIT 1`,
    [mailboxProfile],
  );
  return rows[0] || null;
}

export async function selectConnectedFinanceMailSender() {
  const { rows } = await query(
    `SELECT c.id, c.account_type, c.account_id, c.mailbox_profile, c.account_email, c.account_name,
            c.ms_tenant_id, c.access_token_encrypted, c.refresh_token_encrypted, c.expires_at, c.scope,
            COALESCE(c.needs_reauth, FALSE) AS needs_reauth,
            c.created_at, c.updated_at
     FROM mail_oauth_connections c
     INNER JOIN users u ON u.id = c.account_id
     WHERE c.account_type = 'internal'
       AND c.mailbox_profile = 'finance'
       AND COALESCE(c.needs_reauth, FALSE) = FALSE
       AND u.role = 'finance'
       AND u.is_active = TRUE
     ORDER BY c.updated_at DESC
     LIMIT 1`,
  );
  return rows[0] || null;
}

export async function upsertMailOAuthConnection(values: any) {
  await query(
    `INSERT INTO mail_oauth_connections (
       account_type, account_id, mailbox_profile, account_email, account_name, ms_tenant_id,
       access_token_encrypted, refresh_token_encrypted, expires_at, scope, needs_reauth, updated_at
     )
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, FALSE, NOW())
     ON CONFLICT (account_type, account_id, mailbox_profile)
     DO UPDATE SET
       account_email = EXCLUDED.account_email,
       account_name = EXCLUDED.account_name,
       ms_tenant_id = EXCLUDED.ms_tenant_id,
       access_token_encrypted = EXCLUDED.access_token_encrypted,
       refresh_token_encrypted = EXCLUDED.refresh_token_encrypted,
       expires_at = EXCLUDED.expires_at,
       scope = EXCLUDED.scope,
       needs_reauth = FALSE,
       updated_at = NOW()`,
    values,
  );
}

export async function markMailOAuthNeedsReauth(accountType: any, accountId: any, mailboxProfile: any) {
  await query(
    `UPDATE mail_oauth_connections
     SET needs_reauth = TRUE, updated_at = NOW()
     WHERE account_type = $1 AND account_id = $2 AND mailbox_profile = $3`,
    [accountType || "internal", accountId, mailboxProfile],
  );
}

export async function deleteMailOAuthConnection(accountType: any, accountId: any, mailboxProfile: any) {
  await query(
    `DELETE FROM mail_oauth_connections
     WHERE account_type = $1 AND account_id = $2 AND mailbox_profile = $3`,
    [accountType || "internal", accountId, mailboxProfile],
  );
}

export async function insertOAuthState(values: any) {
  await query(
    `INSERT INTO mail_oauth_states (state, account_type, account_id, mailbox_profile, return_path, expires_at)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    values,
  );
}

export async function consumeOAuthState(state: any) {
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
