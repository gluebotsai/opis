import { query } from "../../db/pool.js";

const PROVIDER_COLUMNS = `
  id, name, image_data, country, storage, account_id,
  created_by, updated_by, created_at, updated_at
`;

const NUMBER_COLUMNS = `
  id, provider_id, number, created_by, updated_by, created_at, updated_at
`;

export async function selectNumberProviders({ search = "" }: any = {}) {
  const params: any[] = [];
  let searchClause = "";
  if (search) {
    params.push(`%${String(search).trim().toLowerCase()}%`);
    searchClause = `WHERE (
      LOWER(p.name) LIKE $1
      OR LOWER(COALESCE(p.country, '')) LIKE $1
      OR LOWER(COALESCE(p.account_id, '')) LIKE $1
      OR LOWER(COALESCE(p.storage, '')) LIKE $1
    )`;
  }

  const { rows } = await query(
    `SELECT p.id, p.name, p.image_data, p.country, p.storage, p.account_id,
            p.created_by, p.updated_by, p.created_at, p.updated_at,
            COUNT(n.id)::int AS number_count
     FROM number_providers p
     LEFT JOIN provider_numbers n ON n.provider_id = p.id
     ${searchClause}
     GROUP BY p.id
     ORDER BY LOWER(p.name) ASC, p.created_at DESC`,
    params,
  );
  return rows;
}

export async function selectNumberProviderById(id: any) {
  const { rows } = await query(
    `SELECT ${PROVIDER_COLUMNS} FROM number_providers WHERE id = $1`,
    [id],
  );
  return rows[0] || null;
}

export async function insertNumberProvider(values: any) {
  const { rows } = await query(
    `INSERT INTO number_providers (
       name, image_data, country, storage, account_id, created_by, updated_by
     ) VALUES ($1, $2, $3, $4, $5, $6, $6)
     RETURNING ${PROVIDER_COLUMNS}`,
    values,
  );
  return rows[0] || null;
}

export async function updateNumberProvider(id: any, values: any) {
  const { rows } = await query(
    `UPDATE number_providers
     SET name = $2,
         image_data = $3,
         country = $4,
         storage = $5,
         account_id = $6,
         updated_by = $7,
         updated_at = NOW()
     WHERE id = $1
     RETURNING ${PROVIDER_COLUMNS}`,
    [id, ...values],
  );
  return rows[0] || null;
}

export async function deleteNumberProvider(id: any) {
  const { rowCount } = await query(`DELETE FROM number_providers WHERE id = $1`, [id]);
  return (rowCount ?? 0) > 0;
}

/** Unassigned inventory across all providers (not already mapped to a tenant). */
export async function selectUnassignedProviderNumbers({ search = "" }: any = {}) {
  const params: any[] = [];
  let searchClause = "";
  if (search) {
    params.push(`%${String(search).trim().toLowerCase()}%`);
    searchClause = `AND LOWER(n.number) LIKE $${params.length}`;
  }

  const { rows } = await query(
    `SELECT n.id, n.provider_id, n.number, n.created_by, n.updated_by, n.created_at, n.updated_at,
            p.name AS provider_name
     FROM provider_numbers n
     JOIN number_providers p ON p.id = n.provider_id
     WHERE NOT EXISTS (
       SELECT 1
       FROM number_mappings m
       WHERE LOWER(TRIM(m.number)) = LOWER(TRIM(n.number))
     )
     ${searchClause}
     ORDER BY n.created_at DESC, n.number ASC`,
    params,
  );
  return rows;
}

/** Unassigned inventory for a provider (not already mapped to a tenant). */
export async function selectProviderNumbers(providerId: any, { search = "" }: any = {}) {
  const params: any[] = [providerId];
  let searchClause = "";
  if (search) {
    params.push(`%${String(search).trim().toLowerCase()}%`);
    searchClause = `AND LOWER(n.number) LIKE $${params.length}`;
  }

  const { rows } = await query(
    `SELECT n.id, n.provider_id, n.number, n.created_by, n.updated_by, n.created_at, n.updated_at
     FROM provider_numbers n
     WHERE n.provider_id = $1
       AND NOT EXISTS (
         SELECT 1
         FROM number_mappings m
         WHERE LOWER(TRIM(m.number)) = LOWER(TRIM(n.number))
       )
       ${searchClause}
     ORDER BY n.created_at DESC, n.number ASC`,
    params,
  );
  return rows;
}

export async function selectProviderNumberByNumber(numberValue: any) {
  const normalized = String(numberValue || "").trim().toLowerCase();
  if (!normalized) {
    return null;
  }
  const { rows } = await query(
    `SELECT n.id, n.provider_id, n.number, n.created_by, n.updated_by, n.created_at, n.updated_at,
            p.name AS provider_name
     FROM provider_numbers n
     JOIN number_providers p ON p.id = n.provider_id
     WHERE LOWER(TRIM(n.number)) = $1
     LIMIT 1`,
    [normalized],
  );
  return rows[0] || null;
}

export async function insertProviderNumber(values: any) {
  const { rows } = await query(
    `INSERT INTO provider_numbers (provider_id, number, created_by, updated_by)
     VALUES ($1, $2, $3, $3)
     RETURNING ${NUMBER_COLUMNS}`,
    values,
  );
  return rows[0] || null;
}

export async function insertProviderNumbersBulk(
  providerId: any,
  numbers: string[],
  actorEmail: any,
) {
  if (!numbers.length) {
    return [];
  }
  const { rows } = await query(
    `INSERT INTO provider_numbers (provider_id, number, created_by, updated_by)
     SELECT $1, n, $2, $2
     FROM UNNEST($3::text[]) AS n
     WHERE NOT EXISTS (
       SELECT 1 FROM provider_numbers existing
       WHERE LOWER(TRIM(existing.number)) = LOWER(TRIM(n))
     )
     RETURNING ${NUMBER_COLUMNS}`,
    [providerId, actorEmail || null, numbers],
  );
  return rows;
}

export async function deleteProviderNumber(id: any) {
  const { rowCount } = await query(`DELETE FROM provider_numbers WHERE id = $1`, [id]);
  return (rowCount ?? 0) > 0;
}

export async function deleteProviderNumberForProvider(providerId: any, numberId: any) {
  const { rowCount } = await query(
    `DELETE FROM provider_numbers WHERE id = $1 AND provider_id = $2`,
    [numberId, providerId],
  );
  return (rowCount ?? 0) > 0;
}

export async function deleteProviderNumbersByNumbers(numbers: any[] = []) {
  const normalized = (numbers || [])
    .map((value) => String(value || "").trim().toLowerCase())
    .filter(Boolean);
  if (!normalized.length) {
    return 0;
  }
  const { rowCount } = await query(
    `DELETE FROM provider_numbers
     WHERE LOWER(TRIM(number)) = ANY($1::text[])`,
    [normalized],
  );
  return rowCount ?? 0;
}
