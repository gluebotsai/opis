import { query } from "../../db/pool.js";

const USAGE_COLUMNS = `
  id, tenant_id, organization_id, number_mapping_id, number, year_month,
  usage_value, usage_unit, notes, entered_by, created_at, updated_at
`;

export async function selectAgentDidUsage({ tenantId = "", yearMonth = "" }: any = {}) {
  const clauses: any[] = [];
  const params: any[] = [];

  if (tenantId) {
    params.push(String(tenantId).trim());
    clauses.push(`tenant_id = $${params.length}`);
  }
  if (yearMonth) {
    params.push(String(yearMonth).trim());
    clauses.push(`year_month = $${params.length}`);
  }

  const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
  const { rows } = await query(
    `SELECT ${USAGE_COLUMNS}
     FROM agent_did_usage_monthly
     ${where}
     ORDER BY number ASC`,
    params,
  );
  return rows;
}

export async function upsertAgentDidUsageRow(values: any) {
  const { rows } = await query(
    `INSERT INTO agent_did_usage_monthly (
      tenant_id, organization_id, number_mapping_id, number, year_month,
      usage_value, usage_unit, notes, entered_by
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
    ON CONFLICT (tenant_id, year_month, number)
    DO UPDATE SET
      organization_id = COALESCE(EXCLUDED.organization_id, agent_did_usage_monthly.organization_id),
      number_mapping_id = COALESCE(EXCLUDED.number_mapping_id, agent_did_usage_monthly.number_mapping_id),
      usage_value = EXCLUDED.usage_value,
      usage_unit = EXCLUDED.usage_unit,
      notes = EXCLUDED.notes,
      entered_by = EXCLUDED.entered_by,
      updated_at = NOW()
    RETURNING ${USAGE_COLUMNS}`,
    values,
  );
  return rows[0] || null;
}

export async function countUsageRowsForMonth(yearMonth: any) {
  const { rows } = await query(
    `SELECT COUNT(*)::int AS count
     FROM agent_did_usage_monthly
     WHERE year_month = $1`,
    [String(yearMonth || "").trim()],
  );
  return rows[0]?.count || 0;
}

export async function selectLatestUsageMonthByTenant() {
  const { rows } = await query(`
    SELECT tenant_id, MAX(year_month) AS last_usage_month
    FROM agent_did_usage_monthly
    GROUP BY tenant_id
  `);
  return rows;
}
