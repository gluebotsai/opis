import { query } from "../../db/pool.js";

export async function selectActiveResellerUserByEmail(email: any) {
  const { rows } = await query(
    `SELECT ru.*, r.company_name, r.is_active AS reseller_is_active
     FROM reseller_users ru
     JOIN resellers r ON r.id = ru.reseller_id
     WHERE LOWER(ru.email) = LOWER($1) AND ru.is_active = TRUE
     LIMIT 1`,
    [email],
  );
  return rows[0] || null;
}

export async function selectResellerPasswordHash(resellerUserId: any) {
  const { rows } = await query(`SELECT password_hash FROM reseller_users WHERE id = $1`, [
    resellerUserId,
  ]);
  return rows[0]?.password_hash || null;
}

export async function updateResellerPassword(resellerUserId: any, passwordHash: any) {
  await query(`UPDATE reseller_users SET password_hash = $1, updated_at = NOW() WHERE id = $2`, [
    passwordHash,
    resellerUserId,
  ]);
}

export async function insertResellerAuthSession(
  token: any,
  resellerUserId: any,
  resellerId: any,
  email: any,
  expiresAt: any,
) {
  await query(
    `INSERT INTO reseller_auth_sessions (token, reseller_user_id, reseller_id, email, expires_at)
     VALUES ($1, $2, $3, $4, $5)`,
    [token, resellerUserId, resellerId, email, expiresAt],
  );
}

export async function selectResellerSession(token: any) {
  const { rows } = await query(
    `SELECT s.*, u.display_name, r.company_name, r.is_active AS reseller_is_active
     FROM reseller_auth_sessions s
     JOIN reseller_users u ON u.id = s.reseller_user_id
     JOIN resellers r ON r.id = s.reseller_id
     WHERE s.token = $1 AND s.expires_at > NOW() AND u.is_active = TRUE AND r.is_active = TRUE`,
    [token],
  );
  return rows[0] || null;
}

export async function deleteResellerSession(token: any) {
  await query(`DELETE FROM reseller_auth_sessions WHERE token = $1`, [token]);
}

export async function deleteResellerSessionsForUser(resellerUserId: any) {
  await query(`DELETE FROM reseller_auth_sessions WHERE reseller_user_id = $1`, [resellerUserId]);
}

export async function hasActiveResellerSessionForUser(resellerUserId: any) {
  if (!resellerUserId) {
    return false;
  }
  const { rows } = await query(
    `SELECT 1 AS ok FROM reseller_auth_sessions
     WHERE reseller_user_id = $1 AND expires_at > NOW()
     LIMIT 1`,
    [resellerUserId],
  );
  return Boolean(rows[0]);
}
