import { pool } from "../../db/pool.js";

export async function selectCustomerProductRequests(organizationId) {
  const { rows } = await pool.query(
    `SELECT * FROM customer_product_requests
     WHERE organization_id = $1
     ORDER BY created_at DESC`,
    [organizationId],
  );
  return rows;
}

export async function selectCustomerProductRequest(requestId, organizationId) {
  const { rows } = await pool.query(
    `SELECT * FROM customer_product_requests
     WHERE id = $1 AND organization_id = $2
     LIMIT 1`,
    [requestId, organizationId],
  );
  return rows[0] || null;
}

export async function insertCustomerProductRequest(values) {
  const { rows } = await pool.query(
    `INSERT INTO customer_product_requests (
      request_number, organization_id, customer_user_id, source_lead_id,
      request_type, status, assignments, product_summary, branch_summary,
      customer_note, domain_id, company_name, contact_email
    ) VALUES ($1, $2, $3, $4, $5, 'submitted', $6, $7, $8, $9, $10, $11, $12)
    RETURNING *`,
    values,
  );
  return rows[0] || null;
}

export async function cancelCustomerProductRequestRow(requestId, organizationId, customerUserId) {
  const { rows } = await pool.query(
    `UPDATE customer_product_requests
     SET status = 'cancelled', updated_at = NOW()
     WHERE id = $1
       AND organization_id = $2
       AND customer_user_id = $3
       AND status = 'submitted'
     RETURNING *`,
    [requestId, organizationId, customerUserId],
  );
  return rows[0] || null;
}
