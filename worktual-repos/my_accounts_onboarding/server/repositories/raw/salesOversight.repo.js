import { query, pool } from "../../db/pool.js";
import { callDbFunction } from "../../db/routines.js";

const PAID_STATUS = "Paid";
const PIPELINE_STATUSES = ["Pending Finance Review", "Approved"];

export async function selectAgentMetrics(params, sql, queryParams) {
  const { rows } = await query(sql, queryParams);
  return rows[0] || {};
}

export function buildAgentMetricsSql(until) {
  const periodFilter = until
    ? "q.submitted_at >= $3::timestamptz AND q.submitted_at < $4::timestamptz"
    : "q.submitted_at >= $3::timestamptz";
  const paidStatusIndex = until ? 5 : 4;
  const pipelineIndex = until ? 6 : 5;

  return {
    sql: `SELECT
       COUNT(DISTINCT l.id)::int AS assigned_leads,
       COUNT(DISTINCT q.id) FILTER (
         WHERE q.submitted_by = $2 AND ${periodFilter}
       )::int AS quotations_submitted,
       COUNT(DISTINCT q.lead_id) FILTER (
         WHERE q.submitted_by = $2 AND q.status = $${paidStatusIndex}
       )::int AS paid_deals,
       COALESCE(SUM(q.grand_total) FILTER (
         WHERE q.submitted_by = $2 AND q.status = $${paidStatusIndex} AND ${periodFilter}
       ), 0) AS revenue,
       COALESCE(SUM(q.grand_total) FILTER (
         WHERE q.submitted_by = $2 AND q.status = ANY($${pipelineIndex}::text[])
       ), 0) AS pipeline_value
     FROM users u
     LEFT JOIN leads l ON l.assigned_user_id = u.id
     LEFT JOIN quotations q ON q.lead_id = l.id OR q.submitted_by = $2
     WHERE u.id = $1
     GROUP BY u.id`,
    paidStatusIndex,
    pipelineIndex,
  };
}

export async function selectPeriodSummary(since, until = null) {
  const { rows } = await callDbFunction(pool, "fn_sales_oversight_period_summary", [
    PAID_STATUS,
    since,
    until,
    PIPELINE_STATUSES,
  ]);
  return rows[0] || {};
}

export async function selectRevenueTrend(since, until = null) {
  const dateFilter = until
    ? "COALESCE(p.paid_at, q.submitted_at) >= $2::timestamptz AND COALESCE(p.paid_at, q.submitted_at) < $3::timestamptz"
    : "COALESCE(p.paid_at, q.submitted_at) >= $2::timestamptz";
  const params = until ? [PAID_STATUS, since, until] : [PAID_STATUS, since];

  const { rows } = await query(
    `SELECT DATE(COALESCE(p.paid_at, q.submitted_at)) AS day,
            COALESCE(SUM(q.grand_total), 0) AS revenue
     FROM quotations q
     LEFT JOIN payments p ON p.quotation_id = q.id
     WHERE q.status = $1
       AND ${dateFilter}
     GROUP BY DATE(COALESCE(p.paid_at, q.submitted_at))
     ORDER BY day ASC`,
    params,
  );
  return rows;
}

export async function selectPipelineFunnelByValue() {
  const funnelStatuses = ["New", "Pending Finance Review", "Approved", "Paid"];
  const { rows } = await callDbFunction(pool, "fn_sales_oversight_pipeline_funnel", [funnelStatuses]);
  return rows;
}

export async function selectTopProductsWithRevenue(since, until = null) {
  const dateFilter = until
    ? "q.submitted_at >= $1::timestamptz AND q.submitted_at < $2::timestamptz"
    : "q.submitted_at >= $1::timestamptz";
  const params = until ? [since, until] : [since];

  const { rows } = await query(
    `SELECT pa.product_id,
            COUNT(*)::int AS quote_count,
            COALESCE(SUM(q.grand_total), 0) AS revenue
     FROM product_assignments pa
     JOIN quotations q ON q.id = pa.quotation_id
     WHERE ${dateFilter}
     GROUP BY pa.product_id
     ORDER BY quote_count DESC, revenue DESC
     LIMIT 6`,
    params,
  );
  return rows;
}

export async function selectRecentLeadActivity() {
  const { rows } = await query(
    `SELECT l.company_name, l.created_at, u.display_name AS actor_name
     FROM leads l
     LEFT JOIN users u ON u.id = l.created_by_user_id
     ORDER BY l.created_at DESC
     LIMIT 5`,
  );
  return rows;
}

export async function selectRecentAssignmentActivity() {
  const { rows } = await query(
    `SELECT l.company_name, la.created_at, ab.display_name AS actor_name, tu.display_name AS to_name
     FROM lead_assignments la
     JOIN leads l ON l.id = la.lead_id
     LEFT JOIN users ab ON ab.id = la.assigned_by_user_id
     LEFT JOIN users tu ON tu.id = la.to_user_id
     WHERE la.from_user_id IS NOT NULL
     ORDER BY la.created_at DESC
     LIMIT 5`,
  );
  return rows;
}

export async function selectRecentApprovalActivity() {
  const { rows } = await query(
    `SELECT l.company_name, q.reviewed_at, q.reviewed_by
     FROM quotations q
     JOIN leads l ON l.id = q.lead_id
     WHERE q.status IN ('Approved', 'Paid') AND q.reviewed_at IS NOT NULL
     ORDER BY q.reviewed_at DESC
     LIMIT 5`,
  );
  return rows;
}

export async function selectRecentPaymentActivity() {
  const { rows } = await query(
    `SELECT l.company_name, p.paid_at, q.grand_total, q.currency
     FROM payments p
     JOIN quotations q ON q.id = p.quotation_id
     JOIN leads l ON l.id = q.lead_id
     WHERE p.status = 'paid' AND p.paid_at IS NOT NULL
     ORDER BY p.paid_at DESC
     LIMIT 5`,
  );
  return rows;
}

export async function selectDashboardMeta() {
  const { rows } = await callDbFunction(pool, "fn_sales_oversight_dashboard_meta", []);
  return rows[0] || {};
}

export async function selectStaleLeads(staleDays) {
  const { rows } = await callDbFunction(pool, "fn_sales_oversight_stale_leads", [
    PAID_STATUS,
    "Rejected",
    staleDays,
    10,
  ]);
  return rows;
}

export async function selectLeadOversightRows(userId) {
  const { rows } = await query(
    `SELECT
       l.id,
       l.domain_id,
       l.company_name,
       l.status,
       l.assigned_at,
       l.updated_at,
       l.created_at,
       (
         SELECT MAX(GREATEST(q.submitted_at, q.reviewed_at))
         FROM quotations q
         WHERE q.lead_id = l.id
       ) AS last_quotation_at,
       (
         SELECT q.status
         FROM quotations q
         WHERE q.lead_id = l.id
         ORDER BY q.submitted_at DESC NULLS LAST
         LIMIT 1
       ) AS latest_quotation_status,
       (
         SELECT q.grand_total
         FROM quotations q
         WHERE q.lead_id = l.id AND q.status = $2
         ORDER BY q.submitted_at DESC NULLS LAST
         LIMIT 1
       ) AS paid_revenue,
       (
         SELECT COALESCE(json_agg(DISTINCT pa.product_id), '[]'::json)
         FROM quotations q
         JOIN product_assignments pa ON pa.quotation_id = q.id
         WHERE q.lead_id = l.id
       ) AS quoted_products,
       (
         SELECT COALESCE(json_agg(DISTINCT ap.product_id), '[]'::json)
         FROM active_products ap
         WHERE ap.lead_id = l.id
       ) AS purchased_products
     FROM leads l
     WHERE l.assigned_user_id = $1
     ORDER BY l.updated_at DESC`,
    [userId, PAID_STATUS],
  );
  return rows;
}

export async function selectAgentProductMix(agentEmail, since, until = null) {
  const productDateFilter = until
    ? "q.submitted_at >= $2::timestamptz AND q.submitted_at < $3::timestamptz"
    : "q.submitted_at >= $2::timestamptz";
  const productParams = until ? [agentEmail, since, until] : [agentEmail, since];

  const { rows } = await query(
    `SELECT pa.product_id,
            COUNT(*)::int AS quoted_count,
            COUNT(DISTINCT ap.product_id)::int AS purchased_count
     FROM quotations q
     JOIN product_assignments pa ON pa.quotation_id = q.id
     LEFT JOIN active_products ap
       ON ap.lead_id = q.lead_id AND ap.product_id = pa.product_id
     WHERE q.submitted_by = $1 AND ${productDateFilter}
     GROUP BY pa.product_id
     ORDER BY quoted_count DESC`,
    productParams,
  );
  return rows;
}

export async function selectLeadAssignmentHistory(leadId) {
  const { rows } = await query(
    `SELECT la.*, 
            fu.display_name AS from_agent_name,
            tu.display_name AS to_agent_name,
            ab.display_name AS assigned_by_name
     FROM lead_assignments la
     LEFT JOIN users fu ON fu.id = la.from_user_id
     LEFT JOIN users tu ON tu.id = la.to_user_id
     LEFT JOIN users ab ON ab.id = la.assigned_by_user_id
     WHERE la.lead_id = $1
     ORDER BY la.created_at DESC
     LIMIT 20`,
    [leadId],
  );
  return rows;
}

export async function selectLeadQuotations(leadId) {
  const { rows } = await query(
    `SELECT id, status, grand_total, currency, submitted_by, submitted_at
     FROM quotations
     WHERE lead_id = $1
     ORDER BY submitted_at DESC NULLS LAST`,
    [leadId],
  );
  return rows;
}

export async function selectUnassignedLeads() {
  const { rows } = await query(
    `SELECT id, domain_id, company_name, status, created_at, updated_at
     FROM leads
     WHERE assigned_user_id IS NULL
     ORDER BY created_at DESC
     LIMIT 50`,
  );
  return rows;
}

export async function insertExportAuditLog(values) {
  const { rows } = await query(
    `INSERT INTO export_audit_logs (
       exported_by_user_id, exported_by_email, exported_by_role,
       agent_user_id, agent_email, agent_name,
       format, scope, row_count, file_name
     ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
     RETURNING *`,
    values,
  );
  return rows[0] || null;
}

export { PAID_STATUS, PIPELINE_STATUSES };
