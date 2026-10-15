import { pool } from "../../db/pool.js";

export async function resolveLeadPortalEventContext(leadId: unknown) {
  if (!leadId) {
    return { partnerId: null, resellerId: null };
  }

  const { rows } = await pool.query(
    `SELECT partner_id, reseller_id FROM leads WHERE id = $1 LIMIT 1`,
    [leadId],
  );
  const row = rows[0];
  return {
    partnerId: row?.partner_id || null,
    resellerId: row?.reseller_id || null,
  };
}
