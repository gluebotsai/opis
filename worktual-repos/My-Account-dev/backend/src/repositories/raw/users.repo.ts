import { query } from "../../db/pool.js";

export async function selectUserIdByEmail(email: any, ignoreUserId: any = null) {
  const { rows } = await query(
    `SELECT id FROM users WHERE email = $1 AND ($2::uuid IS NULL OR id <> $2) LIMIT 1`,
    [email, ignoreUserId],
  );
  return rows[0] || null;
}

export async function selectAllUsers() {
  const { rows } = await query(
    `SELECT * FROM users ORDER BY updated_at DESC, created_at DESC`,
  );
  return rows;
}

export async function selectAllUserEmails() {
  const { rows } = await query(`SELECT LOWER(email) AS email FROM users`);
  return rows.map((row: any) => row.email);
}

export async function selectActiveUsersByRole(role: any) {
  const { rows } = await query(
    `SELECT * FROM users WHERE role = $1 AND is_active = TRUE ORDER BY display_name, email`,
    [role],
  );
  return rows;
}

export async function selectUserById(userId: any) {
  const { rows } = await query(`SELECT * FROM users WHERE id = $1`, [userId]);
  return rows[0] || null;
}

export async function selectActiveSalesAdminUser(role: any) {
  const { rows } = await query(
    `SELECT * FROM users
     WHERE role = $1 AND is_active = TRUE
     ORDER BY created_at ASC
     LIMIT 1`,
    [role],
  );
  return rows[0] || null;
}

export async function selectActiveUserByEmail(email: any) {
  const { rows } = await query(
    `SELECT * FROM users WHERE lower(email) = lower($1) AND is_active = TRUE LIMIT 1`,
    [email],
  );
  return rows[0] || null;
}

export async function updateUserPassword(userId: any, hashedPassword: any) {
  await query(`UPDATE users SET password = $2, updated_at = NOW() WHERE id = $1`, [
    userId,
    hashedPassword,
  ]);
}

export async function insertUser(values: any) {
  const { rows } = await query(
    `INSERT INTO users (
      id, email, password, role, display_name, phone, country, mobile_country_code, mobile_number,
      department, is_active, created_at, updated_at, created_by, updated_by
    ) VALUES (
      gen_random_uuid(), $1, $2, $3, $4, $5, $6, $7, $8, $9, TRUE, NOW(), NOW(), $10, $10
    )
    RETURNING *`,
    values,
  );
  return rows[0] || null;
}

export async function updateUserByAdmin(values: any) {
  const { rows } = await query(
    `UPDATE users SET
      email = $2,
      role = COALESCE($3, role),
      display_name = COALESCE($4, display_name),
      phone = COALESCE($5, phone),
      country = COALESCE($6, country),
      mobile_country_code = COALESCE($7, mobile_country_code),
      mobile_number = COALESCE($8, mobile_number),
      department = COALESCE($9, department),
      is_active = COALESCE($10, is_active),
      password = COALESCE($11, password),
      updated_at = NOW(),
      updated_by = $12
     WHERE id = $1
     RETURNING *`,
    values,
  );
  return rows[0] || null;
}

export async function selectUserIdByNormalizedPhone(phoneDigits: any, ignoreUserId: any = null) {
  const normalized = String(phoneDigits || "").replace(/\D/g, "");
  if (!normalized) {
    return null;
  }

  const { rows } = await query(
    `SELECT id FROM users
     WHERE (
       regexp_replace(COALESCE(mobile_country_code, '') || COALESCE(mobile_number, ''), '\\D', '', 'g') = $1
       OR regexp_replace(COALESCE(phone, ''), '\\D', '', 'g') = $1
     )
     AND ($2::uuid IS NULL OR id <> $2)
     LIMIT 1`,
    [normalized, ignoreUserId],
  );
  return rows[0] || null;
}

export async function deleteUser(userId: any) {
  await query(`DELETE FROM users WHERE id = $1`, [userId]);
}

export async function updateUserProfile(values: any) {
  const { rows } = await query(
    `UPDATE users SET
      email = $2,
      display_name = COALESCE($3, display_name),
      phone = COALESCE($4, phone),
      department = COALESCE($5, department),
      password = COALESCE($6, password),
      updated_at = NOW(),
      updated_by = $7
     WHERE id = $1
     RETURNING *`,
    values,
  );
  return rows[0] || null;
}

export async function updateAdminProfile(values: any) {
  const { rows } = await query(
    `UPDATE users SET
      display_name = COALESCE($2, display_name),
      password = COALESCE($3, password),
      updated_at = NOW(),
      updated_by = $4
     WHERE id = $1
     RETURNING *`,
    values,
  );
  return rows[0] || null;
}
