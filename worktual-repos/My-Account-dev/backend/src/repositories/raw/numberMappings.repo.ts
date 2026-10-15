import { query } from "../../db/pool.js";

const MAPPING_COLUMNS = `
  id, tenant_id, organization_id, lead_id, product_id, provider_id, number, number_type, agent_label,
  status, notes, mapped_at, created_by, updated_by, created_at, updated_at
`;

export async function selectNumberMappings({ search = "", tenantId = "", status = "" }: any = {}) {
  const clauses: any[] = [];
  const params: any[] = [];

  if (tenantId) {
    params.push(String(tenantId).trim());
    clauses.push(`tenant_id = $${params.length}`);
  }

  if (status) {
    params.push(String(status).trim());
    clauses.push(`status = $${params.length}`);
  }

  if (search) {
    params.push(`%${String(search).trim().toLowerCase()}%`);
    clauses.push(
      `(LOWER(number) LIKE $${params.length}
        OR LOWER(tenant_id) LIKE $${params.length}
        OR LOWER(agent_label) LIKE $${params.length}
        OR LOWER(product_id) LIKE $${params.length})`,
    );
  }

  const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
  const { rows } = await query(
    `SELECT ${MAPPING_COLUMNS}
     FROM number_mappings
     ${where}
     ORDER BY mapped_at DESC, created_at DESC`,
    params,
  );
  return rows;
}

export async function selectNumberMappingById(id: any) {
  const { rows } = await query(
    `SELECT ${MAPPING_COLUMNS} FROM number_mappings WHERE id = $1`,
    [id],
  );
  return rows[0] || null;
}

export async function selectNumberMappingsByTenant(tenantId: any) {
  const { rows } = await query(
    `SELECT ${MAPPING_COLUMNS}
     FROM number_mappings
     WHERE tenant_id = $1
     ORDER BY number ASC`,
    [String(tenantId || "").trim()],
  );
  return rows;
}

export async function selectNumberMappingByNumber(numberValue: any, excludeId: any = null) {
  const normalized = String(numberValue || "").trim().toLowerCase();
  if (!normalized) {
    return null;
  }
  const params: any[] = [normalized];
  let sql = `
    SELECT ${MAPPING_COLUMNS}
    FROM number_mappings
    WHERE LOWER(TRIM(number)) = $1
  `;
  if (excludeId) {
    params.push(excludeId);
    sql += ` AND id <> $${params.length}`;
  }
  sql += ` LIMIT 1`;
  const { rows } = await query(sql, params);
  return rows[0] || null;
}

/** Active mapping counts per product for a tenant. */
export async function selectActiveMappingCountsByProductForTenant(tenantId: any) {
  const { rows } = await query(
    `SELECT product_id, COUNT(*)::int AS mapping_count
     FROM number_mappings
     WHERE tenant_id = $1
       AND status = 'active'
       AND NULLIF(TRIM(product_id), '') IS NOT NULL
     GROUP BY product_id`,
    [String(tenantId || "").trim()],
  );
  return rows.map((row: any) => ({
    productId: String(row.product_id),
    mappingCount: Number(row.mapping_count || 0),
  }));
}

export async function insertNumberMapping(values: any) {
  const { rows } = await query(
    `INSERT INTO number_mappings (
      tenant_id, organization_id, lead_id, product_id, number, number_type, agent_label,
      status, notes, mapped_at, created_by, updated_by, provider_id
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, COALESCE($10::timestamptz, NOW()), $11, $11, $12)
    RETURNING ${MAPPING_COLUMNS}`,
    values,
  );
  return rows[0] || null;
}

export async function updateNumberMapping(id: any, values: any) {
  const { rows } = await query(
    `UPDATE number_mappings SET
      tenant_id = $2,
      organization_id = $3,
      lead_id = $4,
      product_id = $5,
      number = $6,
      number_type = $7,
      agent_label = $8,
      status = $9,
      notes = $10,
      mapped_at = COALESCE($11::timestamptz, mapped_at),
      updated_by = $12,
      provider_id = $13,
      updated_at = NOW()
     WHERE id = $1
     RETURNING ${MAPPING_COLUMNS}`,
    [id, ...values],
  );
  return rows[0] || null;
}

export async function deleteNumberMapping(id: any) {
  const { rowCount } = await query(`DELETE FROM number_mappings WHERE id = $1`, [id]);
  return (rowCount ?? 0) > 0;
}

export async function selectNumberMappingStats() {
  const { rows } = await query(`
    SELECT
      COUNT(*)::int AS total_mappings,
      COUNT(*) FILTER (WHERE status = 'active')::int AS active_mappings,
      COUNT(DISTINCT NULLIF(TRIM(tenant_id), ''))::int AS tenants_with_mappings
    FROM number_mappings
  `);
  return rows[0] || { total_mappings: 0, active_mappings: 0, tenants_with_mappings: 0 };
}

export async function selectNumberMappingStatsForTenants(tenantIds: any[] = []) {
  const tenants = (tenantIds || []).map((id) => String(id || "").trim()).filter(Boolean);
  if (!tenants.length) {
    return { total_mappings: 0, active_mappings: 0, tenants_with_mappings: 0 };
  }

  const { rows } = await query(
    `SELECT
       COUNT(*)::int AS total_mappings,
       COUNT(*) FILTER (WHERE status = 'active')::int AS active_mappings,
       COUNT(DISTINCT NULLIF(TRIM(tenant_id), ''))::int AS tenants_with_mappings
     FROM number_mappings
     WHERE tenant_id = ANY($1::text[])`,
    [tenants],
  );
  return rows[0] || { total_mappings: 0, active_mappings: 0, tenants_with_mappings: 0 };
}

export async function selectMappingCountsByTenant() {
  const { rows } = await query(`
    SELECT tenant_id, COUNT(*)::int AS mapping_count
    FROM number_mappings
    WHERE NULLIF(TRIM(tenant_id), '') IS NOT NULL
    GROUP BY tenant_id
  `);
  return rows;
}
