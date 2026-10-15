import { query } from "../../db/pool.js";

export async function deleteExpiredAuthSessions() {
  await query(`DELETE FROM auth_sessions WHERE expires_at <= NOW()`);
}

export async function insertAuthSession({
  token,
  userId,
  email,
  role,
  displayName,
  expiresAt,
}: any) {
  await query(
    `INSERT INTO auth_sessions (token, user_id, email, role, display_name, expires_at)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [token, userId, email, role, displayName, expiresAt],
  );
}

export async function selectAuthSession(token: any) {
  const { rows } = await query(
    `SELECT token, user_id, email, role, display_name, expires_at
     FROM auth_sessions
     WHERE token = $1 AND expires_at > NOW()`,
    [token],
  );
  return rows[0] || null;
}

export async function deleteAuthSession(token: any) {
  await query(`DELETE FROM auth_sessions WHERE token = $1`, [token]);
}

export async function deleteAuthSessionsForUser(userId: any) {
  await query(`DELETE FROM auth_sessions WHERE user_id = $1`, [userId]);
}

export async function hasActiveAuthSessionForUser(userId: any) {
  if (!userId) {
    return false;
  }
  const { rows } = await query(
    `SELECT 1 AS ok FROM auth_sessions WHERE user_id = $1 AND expires_at > NOW() LIMIT 1`,
    [userId],
  );
  return Boolean(rows[0]);
}
