import { query } from "../../db/pool.js";

export async function selectActivePartnerUserByEmail(email: any) {
  const { rows } = await query(
    `SELECT pu.*, p.company_name, p.is_active AS partner_is_active
     FROM partner_users pu
     JOIN partners p ON p.id = pu.partner_id
     WHERE LOWER(pu.email) = LOWER($1) AND pu.is_active = TRUE
     LIMIT 1`,
    [email],
  );
  return rows[0] || null;
}

export async function selectPartnerPasswordHash(partnerUserId: any) {
  const { rows } = await query(`SELECT password_hash FROM partner_users WHERE id = $1`, [
    partnerUserId,
  ]);
  return rows[0]?.password_hash || null;
}

export async function updatePartnerPassword(partnerUserId: any, passwordHash: any) {
  await query(`UPDATE partner_users SET password_hash = $1, updated_at = NOW() WHERE id = $2`, [
    passwordHash,
    partnerUserId,
  ]);
}

export async function insertPartnerAuthSession(
  token: any,
  partnerUserId: any,
  partnerId: any,
  email: any,
  expiresAt: any,
) {
  await query(
    `INSERT INTO partner_auth_sessions (token, partner_user_id, partner_id, email, expires_at)
     VALUES ($1, $2, $3, $4, $5)`,
    [token, partnerUserId, partnerId, email, expiresAt],
  );
}

export async function selectPartnerSession(token: any) {
  const { rows } = await query(
    `SELECT s.*, u.display_name, p.company_name, p.is_active AS partner_is_active
     FROM partner_auth_sessions s
     JOIN partner_users u ON u.id = s.partner_user_id
     JOIN partners p ON p.id = s.partner_id
     WHERE s.token = $1 AND s.expires_at > NOW() AND u.is_active = TRUE AND p.is_active = TRUE`,
    [token],
  );
  return rows[0] || null;
}

export async function deletePartnerSession(token: any) {
  await query(`DELETE FROM partner_auth_sessions WHERE token = $1`, [token]);
}

export async function deletePartnerSessionsForUser(partnerUserId: any) {
  await query(`DELETE FROM partner_auth_sessions WHERE partner_user_id = $1`, [partnerUserId]);
}

export async function hasActivePartnerSessionForUser(partnerUserId: any) {
  if (!partnerUserId) {
    return false;
  }
  const { rows } = await query(
    `SELECT 1 AS ok FROM partner_auth_sessions
     WHERE partner_user_id = $1 AND expires_at > NOW()
     LIMIT 1`,
    [partnerUserId],
  );
  return Boolean(rows[0]);
}
