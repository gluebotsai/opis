import { pool } from "../../db/pool.js";

function runnerQuery(runner: any) {
  if (typeof runner?.query === "function") {
    return runner;
  }
  return pool;
}

export async function insertBranchCancellationRequest(runner: any, values: any) {
  const { rows } = await runnerQuery(runner).query(
    `INSERT INTO branch_cancellation_requests (
      request_number, organization_id, customer_user_id, source_lead_id,
      request_kind, branch_id, product_id, subscription_id, status, trigger_source,
      grace_deadline_at, related_quotation_id, customer_note, tenant_id, company_name, contact_email,
      effective_timing, effective_at
    ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18)
    RETURNING *`,
    values,
  );
  return rows[0] || null;
}

export async function selectBranchCancellationRequestsByOrganization(runner: any, organizationId: any, branchId: any = null) {
  const params = [organizationId];
  let sql = `SELECT * FROM branch_cancellation_requests WHERE organization_id = $1`;
  if (branchId) {
    params.push(branchId);
    sql += ` AND branch_id = $2`;
  }
  sql += ` ORDER BY created_at DESC`;
  const { rows } = await runnerQuery(runner).query(sql, params);
  return rows;
}

export async function selectBranchCancellationRequestById(runner: any, requestId: any) {
  const { rows } = await runnerQuery(runner).query(
    `SELECT * FROM branch_cancellation_requests WHERE id = $1 LIMIT 1`,
    [requestId],
  );
  return rows[0] || null;
}

export async function selectPendingCancellationRequest(runner: any, filters: any) {
  const { organizationId, branchId, subscriptionId, requestKind } = filters;
  const hasSubscriptionId = Boolean(subscriptionId);
  const { rows } = await runnerQuery(runner).query(
    `SELECT * FROM branch_cancellation_requests
     WHERE organization_id = $1
       AND branch_id = $2
       AND request_kind = $3
       AND status IN ('submitted', 'auto_escalated', 'approved_scheduled')
       AND (
         ($4::boolean = true AND subscription_id = $5::uuid)
         OR ($4::boolean = false AND subscription_id IS NULL)
       )
     LIMIT 1`,
    [organizationId, branchId, requestKind, hasSubscriptionId, subscriptionId || null],
  );
  return rows[0] || null;
}

export async function selectOpenCancellationRequest(
  runner: any,
  { organizationId, branchId, requestKind, subscriptionId = null, productId = null }: any,
) {
  const params = [organizationId, branchId, requestKind];
  let sql = `SELECT * FROM branch_cancellation_requests
             WHERE organization_id = $1
               AND branch_id = $2
               AND request_kind = $3
               AND status IN ('submitted', 'auto_escalated', 'approved_scheduled')`;

  if (requestKind === "drop_branch") {
    sql += ` AND subscription_id IS NULL`;
  } else if (subscriptionId) {
    params.push(subscriptionId);
    sql += ` AND subscription_id = $${params.length}::uuid`;
  } else if (productId) {
    params.push(productId);
    sql += ` AND product_id = $${params.length}`;
  }

  sql += ` ORDER BY created_at DESC LIMIT 1`;
  const { rows } = await runnerQuery(runner).query(sql, params);
  return rows[0] || null;
}

export async function withdrawBranchCancellationRequest(runner: any, requestId: any, organizationId: any, _customerUserId: any) {
  const { rows } = await runnerQuery(runner).query(
    `UPDATE branch_cancellation_requests
     SET status = 'withdrawn', updated_at = NOW()
     WHERE id = $1
       AND organization_id = $2
       AND status IN ('submitted', 'auto_escalated')
       AND trigger_source = 'customer'
     RETURNING *`,
    [requestId, organizationId],
  );
  return rows[0] || null;
}

export async function selectAdminCancellationRequests(runner: any, { status = null }: any = {}) {
  const params: any = [];
  let sql = `SELECT r.*, o.company_name AS org_company_name
             FROM branch_cancellation_requests r
             JOIN organizations o ON o.id = r.organization_id`;
  if (status) {
    params.push(status);
    sql += ` WHERE r.status = $1`;
  }
  sql += ` ORDER BY r.created_at DESC`;
  const { rows } = await runnerQuery(runner).query(sql, params);
  return rows;
}

export async function resolveBranchCancellationRequest(
  runner: any,
  requestId: any,
  { status, adminNote, resolvedBy, effectiveAt = null }: any,
) {
  const { rows } = await runnerQuery(runner).query(
    `UPDATE branch_cancellation_requests
     SET status = $2,
         admin_note = COALESCE($3, admin_note),
         effective_at = COALESCE($5, effective_at),
         resolved_at = NOW(),
         resolved_by = $4,
         updated_at = NOW()
     WHERE id = $1
       AND status IN ('submitted', 'auto_escalated')
     RETURNING *`,
    [requestId, status, adminNote || null, resolvedBy, effectiveAt],
  );
  return rows[0] || null;
}

export async function insertBranchCancellationAlert(runner: any, values: any) {
  const { rows } = await runnerQuery(runner).query(
    `INSERT INTO branch_cancellation_alerts (
      alert_type, organization_id, branch_id, product_id, subscription_id,
      quotation_id, grace_deadline_at, request_id
    ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
    ON CONFLICT DO NOTHING
    RETURNING *`,
    values,
  );
  return rows[0] || null;
}

export async function selectOrganizationLocation(runner: any, organizationId: any, branchId: any) {
  const { rows } = await runnerQuery(runner).query(
    `SELECT * FROM organization_locations
     WHERE organization_id = $1 AND id = $2
     LIMIT 1`,
    [organizationId, branchId],
  );
  return rows[0] || null;
}

export async function updateOrganizationLocationInactive(runner: any, organizationId: any, branchId: any, values: any) {
  const { rows } = await runnerQuery(runner).query(
    `UPDATE organization_locations
     SET status = 'inactive',
         inactivated_at = $3,
         inactivated_by = $4,
         inactivation_reason = $5,
         scheduled_drop_at = NULL,
         scheduled_drop_request_id = NULL,
         scheduled_drop_by = NULL,
         scheduled_drop_reason = NULL
     WHERE organization_id = $1 AND id = $2
     RETURNING *`,
    [organizationId, branchId, values.inactivatedAt, values.inactivatedBy, values.reason],
  );
  return rows[0] || null;
}

export async function cancelSubscriptionRow(runner: any, subscriptionId: any, values: any) {
  const { rows } = await runnerQuery(runner).query(
    `UPDATE subscriptions
     SET status = 'cancelled',
         cancelled_at = $2,
         cancelled_by = $3,
         cancellation_reason = $4,
         cancel_at_period_end = FALSE,
         cancel_effective_at = NULL,
         scheduled_cancellation_request_id = NULL,
         updated_at = NOW()
     WHERE id = $1 AND status = 'active'
     RETURNING *`,
    [subscriptionId, values.cancelledAt, values.cancelledBy, values.reason],
  );
  return rows[0] || null;
}

export async function selectActiveSubscriptionsAtLocation(runner: any, organizationId: any, branchId: any) {
  const { rows } = await runnerQuery(runner).query(
    `SELECT * FROM subscriptions
     WHERE organization_id = $1 AND branch_id = $2 AND status = 'active'`,
    [organizationId, branchId],
  );
  return rows;
}

export async function deleteActiveProductRow(runner: any, leadId: any, productId: any, branchId: any) {
  await runnerQuery(runner).query(
    `DELETE FROM active_products
     WHERE lead_id = $1 AND product_id = $2 AND branch_id = $3`,
    [leadId, productId, branchId],
  );
}

export async function deleteGrantsForSubscription(runner: any, subscriptionId: any) {
  await runnerQuery(runner).query(`DELETE FROM product_access_grants WHERE subscription_id = $1`, [
    subscriptionId,
  ]);
}

export async function deactivateBranchCustomerUsers(runner: any, organizationId: any, branchId: any) {
  await runnerQuery(runner).query(
    `UPDATE customer_users
     SET is_active = FALSE, updated_at = NOW()
     WHERE organization_id = $1 AND branch_id = $2 AND is_active = TRUE`,
    [organizationId, branchId],
  );
}

export async function cancelScheduledSubscriptionInvoices(runner: any, subscriptionId: any) {
  await runnerQuery(runner).query(
    `UPDATE subscription_invoices
     SET status = 'cancelled'
     WHERE subscription_id = $1 AND status = 'scheduled'`,
    [subscriptionId],
  );
}

export async function scheduleSubscriptionCancellation(
  runner: any,
  subscriptionId: any,
  { effectiveAt, requestId, adminUser, reason }: any,
) {
  const { rows } = await runnerQuery(runner).query(
    `UPDATE subscriptions
     SET cancel_at_period_end = TRUE,
         cancel_effective_at = $2,
         scheduled_cancellation_request_id = $3,
         cancelled_by = $4,
         cancellation_reason = $5,
         updated_at = NOW()
     WHERE id = $1
       AND status = 'active'
       AND cancel_at_period_end = FALSE
     RETURNING *`,
    [subscriptionId, effectiveAt, requestId, adminUser, reason],
  );
  return rows[0] || null;
}

export async function clearScheduledSubscriptionCancellation(runner: any, subscriptionId: any) {
  const { rows } = await runnerQuery(runner).query(
    `UPDATE subscriptions
     SET cancel_at_period_end = FALSE,
         cancel_effective_at = NULL,
         scheduled_cancellation_request_id = NULL,
         cancelled_by = NULL,
         cancellation_reason = NULL,
         updated_at = NOW()
     WHERE id = $1
       AND status = 'active'
       AND cancel_at_period_end = TRUE
     RETURNING *`,
    [subscriptionId],
  );
  return rows[0] || null;
}

export async function selectSubscriptionsDueForCancellation(runner: any) {
  const { rows } = await runnerQuery(runner).query(
    `SELECT * FROM subscriptions
     WHERE status = 'active'
       AND cancel_at_period_end = TRUE
       AND cancel_effective_at IS NOT NULL
       AND cancel_effective_at <= NOW()`,
  );
  return rows;
}

export async function scheduleBranchDrop(
  runner: any,
  organizationId: any,
  branchId: any,
  { effectiveAt, requestId, adminUser, reason }: any,
) {
  const { rows } = await runnerQuery(runner).query(
    `UPDATE organization_locations
     SET scheduled_drop_at = $3,
         scheduled_drop_request_id = $4,
         scheduled_drop_by = $5,
         scheduled_drop_reason = $6
     WHERE organization_id = $1
       AND id = $2
       AND status = 'active'
       AND scheduled_drop_at IS NULL
     RETURNING *`,
    [organizationId, branchId, effectiveAt, requestId, adminUser, reason],
  );
  return rows[0] || null;
}

export async function clearScheduledBranchDrop(runner: any, organizationId: any, branchId: any) {
  const { rows } = await runnerQuery(runner).query(
    `UPDATE organization_locations
     SET scheduled_drop_at = NULL,
         scheduled_drop_request_id = NULL,
         scheduled_drop_by = NULL,
         scheduled_drop_reason = NULL
     WHERE organization_id = $1
       AND id = $2
       AND status = 'active'
       AND scheduled_drop_at IS NOT NULL
     RETURNING *`,
    [organizationId, branchId],
  );
  return rows[0] || null;
}

export async function selectLocationsDueForDrop(runner: any) {
  const { rows } = await runnerQuery(runner).query(
    `SELECT * FROM organization_locations
     WHERE status = 'active'
       AND scheduled_drop_at IS NOT NULL
       AND scheduled_drop_at <= NOW()`,
  );
  return rows;
}

export async function selectScheduledSubscriptionsAtLocation(runner: any, organizationId: any, branchId: any) {
  const { rows } = await runnerQuery(runner).query(
    `SELECT * FROM subscriptions
     WHERE organization_id = $1
       AND branch_id = $2
       AND status = 'active'
       AND cancel_at_period_end = TRUE`,
    [organizationId, branchId],
  );
  return rows;
}
