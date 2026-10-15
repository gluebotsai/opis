import { query } from "../../db/pool.js";

function runnerQuery(runner: any) {
  if (typeof runner?.query === "function") {
    return runner;
  }
  return query;
}

export async function selectAllResellers(runner: any) {
  const { rows } = await runnerQuery(runner).query(
    `SELECT r.*,
            (
              SELECT json_agg(
                json_build_object(
                  'id', ru.id,
                  'email', ru.email,
                  'displayName', ru.display_name,
                  'isActive', ru.is_active
                )
                ORDER BY ru.email
              )
              FROM reseller_users ru
              WHERE ru.reseller_id = r.id
            ) AS users
     FROM resellers r
     ORDER BY r.company_name ASC`,
  );
  return rows;
}

export async function selectActiveResellers(runner: any) {
  const { rows } = await runnerQuery(runner).query(
    `SELECT id, company_name, contact_name, invoice_email, work_email, is_active
     FROM resellers
     WHERE is_active = TRUE
     ORDER BY company_name ASC`,
  );
  return rows;
}

export async function selectResellerById(runner: any, resellerId: any) {
  const { rows } = await runnerQuery(runner).query(`SELECT * FROM resellers WHERE id = $1`, [
    resellerId,
  ]);
  return rows[0] || null;
}

export async function insertReseller(runner: any, values: any) {
  const { rows } = await runnerQuery(runner).query(
    `INSERT INTO resellers (
      company_name, contact_name, designation, work_email, invoice_email, invoice_cc_emails,
      tax_number, billing_address, country, website_url, mobile_country_code, mobile_number,
      is_active, created_by
    ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
    RETURNING *`,
    values,
  );
  return rows[0] || null;
}

export async function updateReseller(runner: any, resellerId: any, values: any) {
  const { rows } = await runnerQuery(runner).query(
    `UPDATE resellers SET
      company_name = $2,
      contact_name = $3,
      designation = $4,
      work_email = $5,
      invoice_email = $6,
      invoice_cc_emails = $7,
      tax_number = $8,
      billing_address = $9,
      country = $10,
      website_url = $11,
      mobile_country_code = $12,
      mobile_number = $13,
      is_active = $14,
      updated_at = NOW()
     WHERE id = $1
     RETURNING *`,
    [resellerId, ...values],
  );
  return rows[0] || null;
}

export async function insertResellerUser(runner: any, values: any) {
  const { rows } = await runnerQuery(runner).query(
    `INSERT INTO reseller_users (reseller_id, email, password_hash, display_name, is_active)
     VALUES ($1, $2, $3, $4, $5)
     RETURNING *`,
    values,
  );
  return rows[0] || null;
}

export async function updateResellerUser(runner: any, userId: any, values: any) {
  const { rows } = await runnerQuery(runner).query(
    `UPDATE reseller_users SET
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

export async function updateResellerUserPassword(runner: any, userId: any, passwordHash: any) {
  await runnerQuery(runner).query(
    `UPDATE reseller_users SET password_hash = $2, updated_at = NOW() WHERE id = $1`,
    [userId, passwordHash],
  );
}

export async function selectResellerUsersByResellerId(runner: any, resellerId: any) {
  const { rows } = await runnerQuery(runner).query(
    `SELECT * FROM reseller_users WHERE reseller_id = $1 ORDER BY email`,
    [resellerId],
  );
  return rows;
}

export async function selectResellerUserByEmail(email: any) {
  const { rows } = await query(
    `SELECT ru.*, r.company_name AS reseller_company_name, r.is_active AS reseller_is_active
     FROM reseller_users ru
     JOIN resellers r ON r.id = ru.reseller_id
     WHERE LOWER(ru.email) = LOWER($1) AND ru.is_active = TRUE
     LIMIT 1`,
    [email],
  );
  return rows[0] || null;
}

export async function selectLeadsByResellerId(runner: any, resellerId: any) {
  const { rows } = await runnerQuery(runner).query(
    `SELECT * FROM leads WHERE reseller_id = $1 ORDER BY created_at DESC`,
    [resellerId],
  );
  return rows;
}

export async function selectRenewalsByResellerId(runner: any, resellerId: any, withinDays: any = 90) {
  const { rows } = await runnerQuery(runner).query(
    `SELECT re.*, s.product_id, s.organization_id, o.company_name, l.tenant_id
     FROM renewal_events re
     JOIN subscriptions s ON s.id = re.subscription_id
     JOIN organizations o ON o.id = s.organization_id
     JOIN leads l ON l.id = o.source_lead_id
     WHERE o.reseller_id = $1
       AND re.status IN ('scheduled', 'pending_quote', 'quoted')
       AND re.due_at <= NOW() + ($2 || ' days')::interval
     ORDER BY re.due_at ASC`,
    [resellerId, String(withinDays)],
  );
  return rows;
}

export async function selectInvoicesByResellerId(runner: any, resellerId: any) {
  const { rows } = await runnerQuery(runner).query(
    `SELECT q.id AS quotation_id,
            q.lead_id,
            q.status AS quotation_status,
            q.grand_total,
            q.currency,
            q.submitted_at,
            q.reviewed_at,
            l.company_name,
            l.tenant_id,
            'quotation' AS invoice_source
     FROM quotations q
     JOIN leads l ON l.id = q.lead_id
     WHERE l.reseller_id = $1
       AND q.status IN ('Approved', 'Paid')
     UNION ALL
     SELECT NULL AS quotation_id,
            o.source_lead_id AS lead_id,
            si.status AS quotation_status,
            si.grand_total,
            'INR' AS currency,
            si.created_at AS submitted_at,
            NULL AS reviewed_at,
            o.company_name,
            o.tenant_id,
            'subscription' AS invoice_source
     FROM subscription_invoices si
     JOIN subscriptions s ON s.id = si.subscription_id
     JOIN organizations o ON o.id = s.organization_id
     WHERE o.reseller_id = $1
     ORDER BY submitted_at DESC NULLS LAST`,
    [resellerId],
  );
  return rows;
}
