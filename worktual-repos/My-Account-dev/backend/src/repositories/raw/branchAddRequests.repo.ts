function runnerQuery(runner: any) {
  if (typeof runner?.query === "function") {
    return runner;
  }
  throw new Error("A database client or pool is required.");
}

export async function insertBranchAddRequest(runner: any, values: any) {
  const { rows } = await runnerQuery(runner).query(
    `INSERT INTO branch_add_requests (
       id, request_number, organization_id, source_lead_id, requested_by_customer_user_id,
       payload, status, company_name, contact_email
     ) VALUES ($1,$2,$3,$4,$5,$6::jsonb,$7,$8,$9)
     RETURNING *`,
    values,
  );
  return rows[0] || null;
}

export async function selectBranchAddRequestsByOrganization(runner: any, organizationId: any) {
  const { rows } = await runnerQuery(runner).query(
    `SELECT *
     FROM branch_add_requests
     WHERE organization_id = $1
     ORDER BY created_at DESC`,
    [organizationId],
  );
  return rows;
}

export async function selectBranchAddRequestsByLeadId(runner: any, leadId: any) {
  const { rows } = await runnerQuery(runner).query(
    `SELECT *
     FROM branch_add_requests
     WHERE source_lead_id = $1
     ORDER BY created_at DESC`,
    [leadId],
  );
  return rows;
}

export async function selectBranchAddRequestById(runner: any, requestId: any) {
  const { rows } = await runnerQuery(runner).query(
    `SELECT * FROM branch_add_requests WHERE id = $1`,
    [requestId],
  );
  return rows[0] || null;
}

export async function withdrawBranchAddRequest(runner: any, requestId: any, organizationId: any, _customerUserId: any) {
  const { rows } = await runnerQuery(runner).query(
    `UPDATE branch_add_requests
     SET status = 'withdrawn', updated_at = NOW()
     WHERE id = $1
       AND organization_id = $2
       AND status = 'submitted'
     RETURNING *`,
    [requestId, organizationId],
  );
  return rows[0] || null;
}

export async function selectPendingBranchAddRequestCount(runner: any, organizationId: any) {
  const { rows } = await runnerQuery(runner).query(
    `SELECT COUNT(*)::int AS count
     FROM branch_add_requests
     WHERE organization_id = $1 AND status = 'submitted'`,
    [organizationId],
  );
  return rows[0]?.count || 0;
}
