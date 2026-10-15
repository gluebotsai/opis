import { query } from "../../db/pool.js";

function runnerQuery(runner: any) {
  if (typeof runner?.query === "function") {
    return runner;
  }
  return query;
}

export async function selectAllCommissionSlabs(
  runner: any,
  { activeOnly = false, country = null }: any = {},
) {
  const { rows } = await runnerQuery(runner).query(
    `SELECT *
     FROM commission_slabs
     WHERE ($1::boolean IS FALSE OR is_active = TRUE)
       AND ($2::text IS NULL OR country = $2)
     ORDER BY country ASC, sort_order ASC, min_amount ASC, created_at ASC`,
    [activeOnly, country || null],
  );
  return rows;
}

export async function selectCommissionSlabById(runner: any, slabId: any) {
  const { rows } = await runnerQuery(runner).query(`SELECT * FROM commission_slabs WHERE id = $1`, [
    slabId,
  ]);
  return rows[0] || null;
}

export async function insertCommissionSlab(runner: any, values: any) {
  const { rows } = await runnerQuery(runner).query(
    `INSERT INTO commission_slabs (
      country, min_amount, max_amount, rate_percent, currency, sort_order, is_active
    ) VALUES ($1, $2, $3, $4, $5, $6, $7)
    RETURNING *`,
    values,
  );
  return rows[0] || null;
}

export async function updateCommissionSlab(runner: any, slabId: any, values: any) {
  const { rows } = await runnerQuery(runner).query(
    `UPDATE commission_slabs SET
      country = $2,
      min_amount = $3,
      max_amount = $4,
      rate_percent = $5,
      currency = $6,
      sort_order = $7,
      is_active = $8,
      updated_at = NOW()
     WHERE id = $1
     RETURNING *`,
    [slabId, ...values],
  );
  return rows[0] || null;
}

export async function deleteCommissionSlab(runner: any, slabId: any) {
  const { rowCount } = await runnerQuery(runner).query(`DELETE FROM commission_slabs WHERE id = $1`, [
    slabId,
  ]);
  return rowCount > 0;
}

export async function selectPartnerBankAccount(runner: any, partnerId: any) {
  const { rows } = await runnerQuery(runner).query(
    `SELECT * FROM partner_bank_accounts WHERE partner_id = $1`,
    [partnerId],
  );
  return rows[0] || null;
}

export async function upsertPartnerBankAccount(runner: any, values: any) {
  const { rows } = await runnerQuery(runner).query(
    `INSERT INTO partner_bank_accounts (
      partner_id, account_holder_name, bank_name, account_number, ifsc_or_routing, branch_name, iban, swift_bic, is_primary
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, TRUE)
    ON CONFLICT (partner_id) DO UPDATE SET
      account_holder_name = EXCLUDED.account_holder_name,
      bank_name = EXCLUDED.bank_name,
      account_number = EXCLUDED.account_number,
      ifsc_or_routing = EXCLUDED.ifsc_or_routing,
      branch_name = EXCLUDED.branch_name,
      iban = EXCLUDED.iban,
      swift_bic = EXCLUDED.swift_bic,
      is_primary = TRUE,
      updated_at = NOW()
    RETURNING *`,
    values,
  );
  return rows[0] || null;
}

export async function selectCommissionEntryByQuotationId(runner: any, quotationId: any) {
  const { rows } = await runnerQuery(runner).query(
    `SELECT * FROM partner_commission_entries WHERE quotation_id = $1`,
    [quotationId],
  );
  return rows[0] || null;
}

export async function insertCommissionEntry(runner: any, values: any) {
  const { rows } = await runnerQuery(runner).query(
    `INSERT INTO partner_commission_entries (
      partner_id, lead_id, quotation_id, payment_id, deal_amount, slab_id,
      rate_percent, commission_amount, currency, status, accrued_at
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'pending', NOW())
    ON CONFLICT (quotation_id) DO NOTHING
    RETURNING *`,
    values,
  );
  return rows[0] || null;
}

export async function selectCommissionEntriesForPartner(runner: any, partnerId: any) {
  const { rows } = await runnerQuery(runner).query(
    `SELECT e.*,
            l.company_name AS lead_company_name,
            l.tenant_id AS lead_tenant_id
     FROM partner_commission_entries e
     LEFT JOIN leads l ON l.id = e.lead_id
     WHERE e.partner_id = $1
     ORDER BY
       CASE WHEN e.status = 'pending' THEN 0 ELSE 1 END,
       COALESCE(e.paid_at, e.accrued_at) DESC,
       e.created_at DESC`,
    [partnerId],
  );
  return rows;
}

export async function selectCommissionEntriesForFinance(runner: any, { status = null }: any = {}) {
  const { rows } = await runnerQuery(runner).query(
    `SELECT e.*,
            l.company_name AS lead_company_name,
            l.tenant_id AS lead_tenant_id,
            p.company_name AS partner_company_name,
            p.contact_name AS partner_contact_name,
            p.work_email AS partner_work_email,
            p.country AS partner_country,
            b.account_holder_name,
            b.bank_name,
            b.account_number,
            b.ifsc_or_routing,
            b.branch_name,
            b.iban,
            b.swift_bic
     FROM partner_commission_entries e
     LEFT JOIN leads l ON l.id = e.lead_id
     LEFT JOIN partners p ON p.id = e.partner_id
     LEFT JOIN partner_bank_accounts b ON b.partner_id = e.partner_id
     WHERE ($1::text IS NULL OR e.status = $1)
     ORDER BY
       CASE WHEN e.status = 'pending' THEN 0 ELSE 1 END,
       e.accrued_at DESC,
       e.created_at DESC`,
    [status || null],
  );
  return rows;
}

export async function selectCommissionEntryById(runner: any, entryId: any) {
  const { rows } = await runnerQuery(runner).query(
    `SELECT e.*,
            l.company_name AS lead_company_name,
            p.company_name AS partner_company_name
     FROM partner_commission_entries e
     LEFT JOIN leads l ON l.id = e.lead_id
     LEFT JOIN partners p ON p.id = e.partner_id
     WHERE e.id = $1`,
    [entryId],
  );
  return rows[0] || null;
}

export async function selectFinanceCommissionPartners(runner: any, { status = null }: any = {}) {
  const { rows } = await runnerQuery(runner).query(
    `SELECT
        p.id AS partner_id,
        p.company_name AS partner_company_name,
        p.contact_name AS partner_contact_name,
        p.work_email AS partner_work_email,
        p.country AS partner_country,
        COUNT(e.id)::int AS entry_count,
        COUNT(e.id) FILTER (WHERE e.status = 'pending')::int AS pending_count,
        COUNT(e.id) FILTER (WHERE e.status = 'paid')::int AS paid_count,
        COALESCE(SUM(e.deal_amount), 0)::float8 AS deal_total,
        COALESCE(SUM(e.commission_amount) FILTER (WHERE e.status = 'pending'), 0)::float8 AS pending_commission_total,
        COALESCE(SUM(e.commission_amount) FILTER (WHERE e.status = 'paid'), 0)::float8 AS paid_commission_total,
        COALESCE(SUM(e.commission_amount), 0)::float8 AS commission_total,
        MAX(e.currency) AS currency,
        MAX(e.accrued_at) AS latest_accrued_at
     FROM partner_commission_entries e
     INNER JOIN partners p ON p.id = e.partner_id
     WHERE ($1::text IS NULL OR e.status = $1)
     GROUP BY p.id, p.company_name, p.contact_name, p.work_email, p.country
     ORDER BY
       CASE WHEN COUNT(e.id) FILTER (WHERE e.status = 'pending') > 0 THEN 0 ELSE 1 END,
       MAX(e.accrued_at) DESC NULLS LAST,
       p.company_name ASC`,
    [status || null],
  );
  return rows;
}

export async function selectFinancePartnerCommissionOverview(runner: any, partnerId: any) {
  const { rows: partnerRows } = await runnerQuery(runner).query(
    `SELECT
        p.id,
        p.company_name,
        p.contact_name,
        p.work_email,
        p.country,
        p.is_active,
        b.account_holder_name,
        b.bank_name,
        b.account_number,
        b.ifsc_or_routing,
        b.branch_name,
        b.iban,
        b.swift_bic
     FROM partners p
     LEFT JOIN partner_bank_accounts b ON b.partner_id = p.id
     WHERE p.id = $1
     LIMIT 1`,
    [partnerId],
  );
  const partner = partnerRows[0] || null;
  if (!partner) {
    return null;
  }

  const { rows: counts } = await runnerQuery(runner).query(
    `SELECT
        COUNT(l.id)::int AS lead_count,
        COUNT(l.id) FILTER (
          WHERE LOWER(COALESCE(l.status, '')) IN ('paid', 'customer', 'active')
             OR EXISTS (
               SELECT 1 FROM organizations o
               WHERE o.source_lead_id = l.id
             )
        )::int AS customer_count
     FROM leads l
     WHERE l.partner_id = $1`,
    [partnerId],
  );

  const { rows: entries } = await runnerQuery(runner).query(
    `SELECT e.*,
            l.company_name AS lead_company_name,
            l.tenant_id AS lead_tenant_id,
            l.status AS lead_status
     FROM partner_commission_entries e
     LEFT JOIN leads l ON l.id = e.lead_id
     WHERE e.partner_id = $1
     ORDER BY
       CASE WHEN e.status = 'pending' THEN 0 ELSE 1 END,
       e.accrued_at DESC,
       e.created_at DESC`,
    [partnerId],
  );

  return {
    partner,
    leadCount: counts[0]?.lead_count || 0,
    customerCount: counts[0]?.customer_count || 0,
    entries,
  };
}

export async function markCommissionEntryPaid(runner: any, entryId: any, { paidBy, payoutReference, notes }: any) {
  const { rows } = await runnerQuery(runner).query(
    `UPDATE partner_commission_entries SET
      status = 'paid',
      paid_at = NOW(),
      paid_by = $2,
      payout_reference = $3,
      notes = COALESCE($4, notes),
      updated_at = NOW()
     WHERE id = $1 AND status = 'pending'
     RETURNING *`,
    [entryId, paidBy, payoutReference || null, notes || null],
  );
  return rows[0] || null;
}

export async function selectPartnerLeadPartnerId(runner: any, leadId: any) {
  const { rows } = await runnerQuery(runner).query(
    `SELECT id, partner_id, company_name, country FROM leads WHERE id = $1`,
    [leadId],
  );
  return rows[0] || null;
}
