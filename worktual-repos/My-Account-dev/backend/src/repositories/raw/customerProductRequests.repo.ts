import { pool } from "../../db/pool.js";
import { QUOTATION_STATUSES } from "../../lib/statuses.js";

export async function selectCustomerProductRequests(organizationId: any) {
  const { rows } = await pool.query(
    `SELECT * FROM customer_product_requests
     WHERE organization_id = $1
     ORDER BY created_at DESC`,
    [organizationId],
  );
  return rows;
}

export async function selectCustomerProductRequestsByLeadId(sourceLeadId: any) {
  const { rows } = await pool.query(
    `SELECT * FROM customer_product_requests
     WHERE source_lead_id = $1
     ORDER BY created_at DESC`,
    [sourceLeadId],
  );
  return rows;
}

export async function selectCustomerProductRequestsByLeadIds(leadIds: any) {
  const ids = Array.isArray(leadIds) ? leadIds.filter(Boolean) : [];
  if (!ids.length) {
    return [];
  }

  const { rows } = await pool.query(
    `SELECT * FROM customer_product_requests
     WHERE source_lead_id = ANY($1::uuid[])
     ORDER BY created_at DESC`,
    [ids],
  );
  return rows;
}

export async function selectAllCustomerProductRequests() {
  const { rows } = await pool.query(
    `SELECT * FROM customer_product_requests
     ORDER BY created_at DESC`,
  );
  return rows;
}

export async function selectCustomerProductRequest(requestId: any, organizationId: any) {
  const { rows } = await pool.query(
    `SELECT * FROM customer_product_requests
     WHERE id = $1 AND organization_id = $2
     LIMIT 1`,
    [requestId, organizationId],
  );
  return rows[0] || null;
}

export async function insertCustomerProductRequest(values: any) {
  const { rows } = await pool.query(
    `INSERT INTO customer_product_requests (
      request_number, organization_id, customer_user_id, source_lead_id,
      request_type, status, assignments, product_summary, branch_summary,
      customer_note, tenant_id, company_name, contact_email, new_branches
    ) VALUES ($1, $2, $3, $4, $5, 'submitted', $6, $7, $8, $9, $10, $11, $12, $13::jsonb)
    RETURNING *`,
    values,
  );
  return rows[0] || null;
}

export async function cancelCustomerProductRequestRow(requestId: any, organizationId: any, _customerUserId: any) {
  const { rows } = await pool.query(
    `UPDATE customer_product_requests
     SET status = 'cancelled', updated_at = NOW()
     WHERE id = $1
       AND organization_id = $2
       AND status = 'submitted'
     RETURNING *`,
    [requestId, organizationId],
  );
  return rows[0] || null;
}

export async function fulfillCustomerProductRequestRow(runner: any, requestId: any) {
  const { rows } = await runnerQuery(runner).query(
    `UPDATE customer_product_requests
     SET status = 'fulfilled', updated_at = NOW()
     WHERE id = $1
       AND status = 'submitted'
     RETURNING *`,
    [requestId],
  );
  return rows[0] || null;
}

export async function updateCustomerProductRequestAssignments(
  runner: any,
  requestId: any,
  { assignments, productSummary, branchSummary }: any,
) {
  const { rows } = await runnerQuery(runner).query(
    `UPDATE customer_product_requests
     SET assignments = $2::jsonb,
         product_summary = $3::jsonb,
         branch_summary = $4::jsonb,
         updated_at = NOW()
     WHERE id = $1
       AND status = 'submitted'
     RETURNING *`,
    [
      requestId,
      JSON.stringify(assignments || []),
      JSON.stringify(productSummary || []),
      branchSummary == null ? null : JSON.stringify(branchSummary),
    ],
  );
  return rows[0] || null;
}

export async function updateCustomerProductRequestDetails(
  requestId: any,
  organizationId: any,
  {
    requestType,
    assignments,
    productSummary,
    branchSummary,
    newBranches,
    customerNote,
  }: any,
) {
  const { rows } = await pool.query(
    `UPDATE customer_product_requests
     SET request_type = $3,
         assignments = $4::jsonb,
         product_summary = $5::jsonb,
         branch_summary = $6::jsonb,
         new_branches = $7::jsonb,
         customer_note = $8,
         updated_at = NOW()
     WHERE id = $1
       AND organization_id = $2
       AND status = 'submitted'
     RETURNING *`,
    [
      requestId,
      organizationId,
      requestType,
      JSON.stringify(assignments || []),
      JSON.stringify(productSummary || []),
      branchSummary == null ? null : JSON.stringify(branchSummary),
      JSON.stringify(newBranches || []),
      customerNote || "",
    ],
  );
  return rows[0] || null;
}

export async function touchCustomerProductRequest(requestId: any, organizationId: any) {
  const { rows } = await pool.query(
    `UPDATE customer_product_requests
     SET updated_at = NOW()
     WHERE id = $1
       AND organization_id = $2
       AND status = 'submitted'
     RETURNING *`,
    [requestId, organizationId],
  );
  return rows[0] || null;
}

export async function selectSubmittedCustomerProductRequests(organizationId: any) {
  const { rows } = await pool.query(
    `SELECT * FROM customer_product_requests
     WHERE organization_id = $1
       AND status = 'submitted'
     ORDER BY created_at DESC`,
    [organizationId],
  );
  return rows;
}

export async function selectCustomerProductRequestById(runner: any, requestId: any) {
  const { rows } = await runnerQuery(runner).query(
    `SELECT * FROM customer_product_requests WHERE id = $1 LIMIT 1`,
    [requestId],
  );
  return rows[0] || null;
}

export async function selectSubmittedProductRequestsByLeadId(runner: any, sourceLeadId: any) {
  const { rows } = await runnerQuery(runner).query(
    `SELECT * FROM customer_product_requests
     WHERE source_lead_id = $1 AND status = 'submitted'
     ORDER BY created_at DESC`,
    [sourceLeadId],
  );
  return rows;
}

/** Close submitted requests that already have a finance-approved or paid linked quotation. */
export async function fulfillProductRequestsWithApprovedQuotations(runner: any, {
  leadId = null,
  organizationId = null,
}: { leadId?: string | null; organizationId?: string | null } = {}) {
  const params: any[] = [[QUOTATION_STATUSES.APPROVED, QUOTATION_STATUSES.PAID]];
  let scopeClause = "";

  if (leadId) {
    params.push(leadId);
    scopeClause = `AND cpr.source_lead_id = $${params.length}`;
  } else if (organizationId) {
    params.push(organizationId);
    scopeClause = `AND cpr.organization_id = $${params.length}`;
  }

  const { rows } = await runnerQuery(runner).query(
    `UPDATE customer_product_requests cpr
     SET status = 'fulfilled', updated_at = NOW()
     WHERE cpr.status = 'submitted'
       ${scopeClause}
       AND EXISTS (
         SELECT 1
         FROM quotations q
         WHERE q.source_product_request_id = cpr.id
           AND q.status = ANY($1::text[])
       )
     RETURNING cpr.*`,
    params,
  );
  return rows;
}

function runnerQuery(runner: any) {
  if (typeof runner?.query === "function") {
    return runner;
  }
  return pool;
}
