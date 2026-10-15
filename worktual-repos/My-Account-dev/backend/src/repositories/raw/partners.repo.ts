import { query } from "../../db/pool.js";

function runnerQuery(runner: any) {
  if (typeof runner?.query === "function") {
    return runner;
  }
  return query;
}

export async function selectAllPartners(runner: any) {
  const { rows } = await runnerQuery(runner).query(
    `SELECT p.*,
            (
              SELECT json_agg(
                json_build_object(
                  'id', pu.id,
                  'email', pu.email,
                  'displayName', pu.display_name,
                  'isActive', pu.is_active
                )
                ORDER BY pu.email
              )
              FROM partner_users pu
              WHERE pu.partner_id = p.id
            ) AS users
     FROM partners p
     ORDER BY p.company_name ASC`,
  );
  return rows;
}

export async function selectPartnerById(runner: any, partnerId: any) {
  const { rows } = await runnerQuery(runner).query(`SELECT * FROM partners WHERE id = $1`, [
    partnerId,
  ]);
  return rows[0] || null;
}

export async function selectPartnerIdByWorkEmail(
  runner: any,
  email: any,
  ignorePartnerId: any = null,
) {
  const normalized = String(email || "").trim().toLowerCase();
  if (!normalized) {
    return null;
  }

  const { rows } = await runnerQuery(runner).query(
    `SELECT id FROM partners
     WHERE LOWER(TRIM(work_email)) = $1
       AND ($2::uuid IS NULL OR id <> $2)
     LIMIT 1`,
    [normalized, ignorePartnerId],
  );
  return rows[0] || null;
}

export async function selectPartnerIdByUserEmail(
  runner: any,
  email: any,
  ignorePartnerId: any = null,
) {
  const normalized = String(email || "").trim().toLowerCase();
  if (!normalized) {
    return null;
  }

  const { rows } = await runnerQuery(runner).query(
    `SELECT partner_id AS id FROM partner_users
     WHERE LOWER(TRIM(email)) = $1
       AND ($2::uuid IS NULL OR partner_id <> $2)
     LIMIT 1`,
    [normalized, ignorePartnerId],
  );
  return rows[0] || null;
}

export async function selectPartnerIdByNormalizedPhone(
  runner: any,
  phoneDigits: any,
  ignorePartnerId: any = null,
) {
  const normalized = String(phoneDigits || "").replace(/\D/g, "");
  if (!normalized) {
    return null;
  }

  const { rows } = await runnerQuery(runner).query(
    `SELECT id FROM partners
     WHERE regexp_replace(
       COALESCE(mobile_country_code, '') || COALESCE(mobile_number, ''),
       '\\D', '', 'g'
     ) = $1
       AND ($2::uuid IS NULL OR id <> $2)
     LIMIT 1`,
    [normalized, ignorePartnerId],
  );
  return rows[0] || null;
}

export async function insertPartner(runner: any, values: any) {
  const { rows } = await runnerQuery(runner).query(
    `INSERT INTO partners (
      company_name, contact_name, designation, work_email, country, website_url,
      mobile_country_code, mobile_number, is_active, created_by
    ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
    RETURNING *`,
    values,
  );
  return rows[0] || null;
}

export async function updatePartner(runner: any, partnerId: any, values: any) {
  const { rows } = await runnerQuery(runner).query(
    `UPDATE partners SET
      company_name = $2,
      contact_name = $3,
      designation = $4,
      work_email = $5,
      country = $6,
      website_url = $7,
      mobile_country_code = $8,
      mobile_number = $9,
      is_active = $10,
      updated_at = NOW()
     WHERE id = $1
     RETURNING *`,
    [partnerId, ...values],
  );
  return rows[0] || null;
}

export async function insertPartnerUser(runner: any, values: any) {
  const { rows } = await runnerQuery(runner).query(
    `INSERT INTO partner_users (partner_id, email, password_hash, display_name, is_active)
     VALUES ($1, $2, $3, $4, $5)
     RETURNING *`,
    values,
  );
  return rows[0] || null;
}

export async function updatePartnerUser(runner: any, userId: any, values: any) {
  const { rows } = await runnerQuery(runner).query(
    `UPDATE partner_users SET
      email = $2,
      display_name = $3,
      is_active = $4,
      updated_at = NOW()
     WHERE id = $1
     RETURNING *`,
    [userId, ...values],
  );
  return rows[0] || null;
}

export async function updatePartnerUserPassword(runner: any, userId: any, passwordHash: any) {
  await runnerQuery(runner).query(
    `UPDATE partner_users SET password_hash = $2, updated_at = NOW() WHERE id = $1`,
    [userId, passwordHash],
  );
}

export async function selectPartnerUsersByPartnerId(runner: any, partnerId: any) {
  const { rows } = await runnerQuery(runner).query(
    `SELECT * FROM partner_users WHERE partner_id = $1 ORDER BY email`,
    [partnerId],
  );
  return rows;
}

export async function selectLeadsByPartnerId(runner: any, partnerId: any) {
  const { rows } = await runnerQuery(runner).query(
    `SELECT * FROM leads WHERE partner_id = $1 ORDER BY created_at DESC`,
    [partnerId],
  );
  return rows;
}

export async function countPartnerLinkedRecords(runner: any, partnerId: any) {
  const { rows } = await runnerQuery(runner).query(
    `SELECT
       (SELECT COUNT(*)::int FROM leads WHERE partner_id = $1) AS lead_count,
       (SELECT COUNT(*)::int FROM partner_commission_entries WHERE partner_id = $1) AS commission_count`,
    [partnerId],
  );
  return {
    leadCount: Number(rows[0]?.lead_count) || 0,
    commissionCount: Number(rows[0]?.commission_count) || 0,
  };
}

export async function deletePartnerById(runner: any, partnerId: any) {
  const { rowCount } = await runnerQuery(runner).query(`DELETE FROM partners WHERE id = $1`, [
    partnerId,
  ]);
  return Number(rowCount) > 0;
}
