import { query } from "../../db/pool.js";

export async function invalidateOpenPasswordResets(email: any) {
  await query(
    `UPDATE password_reset_otps
     SET consumed_at = NOW()
     WHERE lower(email) = lower($1) AND consumed_at IS NULL`,
    [email],
  );
}

export async function insertPasswordResetOtp(values: any) {
  const { rows } = await query(
    `INSERT INTO password_reset_otps (
       email, account_type, account_id, otp_hash, expires_at
     ) VALUES ($1, $2, $3, $4, $5)
     RETURNING *`,
    values,
  );
  return rows[0] || null;
}

export async function selectLatestOpenPasswordReset(email: any) {
  const { rows } = await query(
    `SELECT * FROM password_reset_otps
     WHERE lower(email) = lower($1)
       AND consumed_at IS NULL
       AND expires_at > NOW()
     ORDER BY created_at DESC
     LIMIT 1`,
    [email],
  );
  return rows[0] || null;
}

export async function incrementPasswordResetAttempts(id: any) {
  const { rows } = await query(
    `UPDATE password_reset_otps
     SET attempts = attempts + 1
     WHERE id = $1
     RETURNING *`,
    [id],
  );
  return rows[0] || null;
}

export async function attachPasswordResetToken(id: any, resetTokenHash: any, resetTokenExpiresAt: any) {
  const { rows } = await query(
    `UPDATE password_reset_otps
     SET reset_token_hash = $2,
         reset_token_expires_at = $3
     WHERE id = $1 AND consumed_at IS NULL
     RETURNING *`,
    [id, resetTokenHash, resetTokenExpiresAt],
  );
  return rows[0] || null;
}

export async function selectOpenPasswordResetByToken(email: any, resetTokenHash: any) {
  const { rows } = await query(
    `SELECT * FROM password_reset_otps
     WHERE lower(email) = lower($1)
       AND reset_token_hash = $2
       AND consumed_at IS NULL
       AND reset_token_expires_at > NOW()
     ORDER BY created_at DESC
     LIMIT 1`,
    [email, resetTokenHash],
  );
  return rows[0] || null;
}

export async function consumePasswordReset(id: any) {
  await query(`UPDATE password_reset_otps SET consumed_at = NOW() WHERE id = $1`, [id]);
}
