import { query } from "../../db/pool.js";

function runnerQuery(runner: any) {
  if (typeof runner?.query === "function") {
    return runner;
  }
  throw new Error("A database client or pool is required.");
}

export async function selectAllTenantIds(runner: any) {
  const { rows } = await runnerQuery(runner).query(`SELECT tenant_id FROM leads`);
  return rows;
}

export async function selectLeads(
  runner: any,
  { createdByUserId = null, pipelineOnly = false, leadKind = null }: any = {},
) {
  const conditions: any[] = [];
  const params: any = [];

  if (createdByUserId) {
    params.push(createdByUserId);
    conditions.push(`(created_by_user_id = $${params.length} OR assigned_user_id = $${params.length})`);
  }

  if (pipelineOnly) {
    // Keep Approved (and earlier) on Leads until paid. Finance approve may set
    // converted_organization_id early; Customers lists Paid / Partially paid and
    // any active (converted) org. Existing customers with open quotes stay
    // Partially paid — not demoted to Approved — so they do not reappear here.
    conditions.push(`status NOT IN ('Paid', 'Partially paid')`);
  }

  const kind = String(leadKind || "").toLowerCase();
  if (kind === "temporary") {
    conditions.push(`COALESCE(lead_kind, 'standard') = 'temporary'`);
  } else {
    // Standard / All / Mine lists never include temporary leads.
    conditions.push(`COALESCE(lead_kind, 'standard') <> 'temporary'`);
  }

  const whereClause = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";
  const { rows } = await runnerQuery(runner).query(
    `SELECT * FROM leads ${whereClause} ORDER BY created_at DESC`,
    params,
  );
  return rows;
}

export async function selectLeadById(runner: any, leadId: any) {
  const { rows } = await runnerQuery(runner).query(`SELECT * FROM leads WHERE id = $1`, [leadId]);
  return rows[0] || null;
}

export async function selectLeadOwnershipRow(runner: any, leadId: any) {
  const { rows } = await runnerQuery(runner).query(
    `SELECT id, assigned_user_id, created_by_user_id, partner_id, reseller_id FROM leads WHERE id = $1`,
    [leadId],
  );
  return rows[0] || null;
}

export async function selectSubscriptionsForLead(runner: any, leadId: any) {
  const { rows } = await runnerQuery(runner).query(
    `SELECT * FROM subscriptions WHERE source_lead_id = $1 ORDER BY product_id, branch_id`,
    [leadId],
  );
  return rows;
}

export async function selectActiveProductsForLead(runner: any, leadId: any) {
  const { rows } = await runnerQuery(runner).query(
    `SELECT ap.*,
            pgl.lifecycle_status AS lifecycle_status,
            pgl.id AS go_live_id
     FROM active_products ap
     LEFT JOIN product_go_live pgl
       ON pgl.lead_id = ap.lead_id
      AND pgl.product_id = ap.product_id
      AND pgl.branch_id = ap.branch_id
     WHERE ap.lead_id = $1
     ORDER BY ap.approved_at DESC NULLS LAST`,
    [leadId],
  );
  return rows;
}

export async function selectAdditionalAddressesForLead(runner: any, leadId: any) {
  const { rows } = await runnerQuery(runner).query(
    `SELECT id, label, address, country, state, tax_number, industry_type, business_type, company_size,
            website_url, contact_name, designation, work_email,
            mobile_country_code, mobile_number, secondary_mobile_country_code, secondary_mobile_number
     FROM additional_addresses WHERE lead_id = $1 ORDER BY label`,
    [leadId],
  );
  return rows;
}

export async function selectLatestQuotationMetaForLead(runner: any, leadId: any) {
  const { rows } = await runnerQuery(runner).query(
    `SELECT id, status, finance_note, reviewed_at, reviewed_by
     FROM quotations
     WHERE lead_id = $1
     ORDER BY submitted_at DESC NULLS LAST
     LIMIT 1`,
    [leadId],
  );
  return rows[0] || null;
}

export async function upsertBranchRow(runner: any, values: any) {
  await runnerQuery(runner).query(
    `INSERT INTO branches (id, lead_id, label, address, country, state, tax_number, is_primary)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
     ON CONFLICT (lead_id, id) DO UPDATE SET
       label = EXCLUDED.label,
       address = EXCLUDED.address,
       country = EXCLUDED.country,
       state = EXCLUDED.state,
       tax_number = EXCLUDED.tax_number,
       is_primary = EXCLUDED.is_primary`,
    values,
  );
}

export async function deleteAdditionalAddressesExcept(runner: any, leadId: any, retainedIds: any) {
  if (retainedIds.length) {
    await runnerQuery(runner).query(
      `DELETE FROM additional_addresses
       WHERE lead_id = $1 AND NOT (id = ANY($2::uuid[]))`,
      [leadId, retainedIds],
    );
    return;
  }

  await runnerQuery(runner).query(`DELETE FROM additional_addresses WHERE lead_id = $1`, [leadId]);
}

export async function upsertAdditionalAddressRow(runner: any, values: any) {
  await runnerQuery(runner).query(
    `INSERT INTO additional_addresses (
       id, lead_id, label, address, country, state, tax_number, industry_type, business_type, company_size,
       website_url, contact_name, designation, work_email,
       mobile_country_code, mobile_number, secondary_mobile_country_code, secondary_mobile_number
     )
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18)
     ON CONFLICT (id) DO UPDATE SET
       lead_id = EXCLUDED.lead_id,
       label = EXCLUDED.label,
       address = EXCLUDED.address,
       country = EXCLUDED.country,
       state = EXCLUDED.state,
       tax_number = EXCLUDED.tax_number,
       industry_type = EXCLUDED.industry_type,
       business_type = EXCLUDED.business_type,
       company_size = EXCLUDED.company_size,
       website_url = EXCLUDED.website_url,
       contact_name = EXCLUDED.contact_name,
       designation = EXCLUDED.designation,
       work_email = EXCLUDED.work_email,
       mobile_country_code = EXCLUDED.mobile_country_code,
       mobile_number = EXCLUDED.mobile_number,
       secondary_mobile_country_code = EXCLUDED.secondary_mobile_country_code,
       secondary_mobile_number = EXCLUDED.secondary_mobile_number`,
    values,
  );
}

export async function insertLeadRow(runner: any, values: any) {
  const { rows } = await runnerQuery(runner).query(
    `INSERT INTO leads (
      id, company_name, industry_type, business_type, contact_name, designation, work_email, admin_email,
      tax_number, billing_address, website_url, country, state, company_size, is_decision_maker,
      decision_maker_name, mobile_country_code, mobile_number,
      secondary_mobile_country_code, secondary_mobile_number, status, is_active, tenant_id,
      assigned_user_id, created_by_user_id, assigned_at, reseller_id, partner_id, organization_id,
      lead_kind, created_at, updated_at
    ) VALUES (
      gen_random_uuid(), $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26,$27,$28,$29, NOW(), NOW()
    )
    RETURNING *`,
    values,
  );
  return rows[0] || null;
}

export async function insertLeadAssignmentRow(runner: any, values: any) {
  await runnerQuery(runner).query(
    `INSERT INTO lead_assignments (lead_id, from_user_id, to_user_id, assigned_by_user_id, reason)
     VALUES ($1, $2, $3, $4, $5)`,
    values,
  );
}

export async function selectLeadAssignedUserId(runner: any, leadId: any) {
  const { rows } = await runnerQuery(runner).query(
    `SELECT assigned_user_id, created_by_user_id FROM leads WHERE id = $1`,
    [leadId],
  );
  return rows[0] || null;
}

export async function updateLeadAssignment(runner: any, leadId: any, toUserId: any) {
  await runnerQuery(runner).query(
    `UPDATE leads
     SET assigned_user_id = $2,
         created_by_user_id = $2,
         assigned_at = NOW(),
         updated_at = NOW()
     WHERE id = $1`,
    [leadId, toUserId],
  );
}

/** Update creator only (used when offboarding a creator who is not the assignee). */
export async function updateLeadCreator(runner: any, leadId: any, toUserId: any) {
  await runnerQuery(runner).query(
    `UPDATE leads
     SET created_by_user_id = $2, updated_at = NOW()
     WHERE id = $1`,
    [leadId, toUserId],
  );
}

export async function countLeadsOwnedByUser(runner: any, userId: any) {
  if (!userId) {
    return 0;
  }
  const { rows } = await runnerQuery(runner).query(
    `SELECT COUNT(*)::int AS count
     FROM leads
     WHERE assigned_user_id = $1 OR created_by_user_id = $1`,
    [userId],
  );
  return Number(rows[0]?.count) || 0;
}

export async function selectLeadsOwnedByUser(runner: any, userId: any) {
  if (!userId) {
    return [];
  }
  const { rows } = await runnerQuery(runner).query(
    `SELECT id, assigned_user_id, created_by_user_id
     FROM leads
     WHERE assigned_user_id = $1 OR created_by_user_id = $1
     ORDER BY updated_at DESC`,
    [userId],
  );
  return rows;
}

export async function updateLeadRow(runner: any, values: any) {
  await runnerQuery(runner).query(
    `UPDATE leads SET
      company_name = $2,
      industry_type = $3,
      business_type = $4,
      contact_name = $5,
      designation = $6,
      work_email = $7,
      admin_email = $8,
      tax_number = $9,
      billing_address = $10,
      website_url = $11,
      country = $12,
      state = $13,
      company_size = $14,
      is_decision_maker = $15,
      decision_maker_name = $16,
      mobile_country_code = $17,
      mobile_number = $18,
      secondary_mobile_country_code = $19,
      secondary_mobile_number = $20,
      status = $21,
      is_active = $22,
      product_draft = $23,
      reseller_id = $24,
      updated_at = NOW()
     WHERE id = $1`,
    values,
  );
}

export async function updateLeadStatusRaw(runner: any, leadId: any, status: any) {
  await runnerQuery(runner).query(`UPDATE leads SET status = $2, updated_at = NOW() WHERE id = $1`, [
    leadId,
    status,
  ]);
}

function phoneDigitsSql(columnPrefix: any = "") {
  const prefix = columnPrefix ? `${columnPrefix}.` : "";
  return `regexp_replace(COALESCE(${prefix}mobile_country_code, '') || COALESCE(${prefix}mobile_number, ''), '\\D', '', 'g')`;
}

export async function findLeadContactConflicts({
  emails = [],
  phones = [],
  ignoreLeadId = null,
  ignoreUserId = null,
  ignorePartnerId = null,
  ignoreResellerId = null,
}: any = {}) {
  const normalizedEmails = emails.filter(Boolean);
  const normalizedPhones = phones.filter(Boolean);
  const conflicts: any[] = [];

    if (normalizedEmails.length) {
    const { rows } = await query(
      `SELECT 'lead_work_email' AS source, l.id AS lead_id, l.work_email AS value
       FROM leads l
       WHERE LOWER(TRIM(l.work_email)) = ANY($1::text[])
         AND ($2::uuid IS NULL OR l.id <> $2)
       UNION ALL
       SELECT 'lead_admin_email', l.id, l.admin_email
       FROM leads l
       WHERE LOWER(TRIM(l.admin_email)) = ANY($1::text[])
         AND ($2::uuid IS NULL OR l.id <> $2)
       UNION ALL
       SELECT 'branch_work_email', aa.lead_id, aa.work_email
       FROM additional_addresses aa
       WHERE LOWER(TRIM(aa.work_email)) = ANY($1::text[])
         AND ($2::uuid IS NULL OR aa.lead_id <> $2)
       UNION ALL
       SELECT 'staff_email', NULL, u.email
       FROM users u
       WHERE LOWER(TRIM(u.email)) = ANY($1::text[])
         AND ($3::uuid IS NULL OR u.id <> $3)
       UNION ALL
       SELECT 'customer_portal_email', NULL, cu.email
       FROM customer_users cu
       WHERE LOWER(TRIM(cu.email)) = ANY($1::text[])
         AND NOT EXISTS (
           SELECT 1
           FROM organizations o
           WHERE o.id = cu.organization_id
             AND $2::uuid IS NOT NULL
             AND o.source_lead_id = $2
         )
       UNION ALL
       SELECT 'partner_user_email', NULL, pu.email
       FROM partner_users pu
       WHERE LOWER(TRIM(pu.email)) = ANY($1::text[])
         AND ($4::uuid IS NULL OR pu.partner_id <> $4)
       UNION ALL
       SELECT 'partner_work_email', NULL, p.work_email
       FROM partners p
       WHERE LOWER(TRIM(p.work_email)) = ANY($1::text[])
         AND TRIM(p.work_email) <> ''
         AND ($4::uuid IS NULL OR p.id <> $4)
       UNION ALL
       SELECT 'reseller_work_email', NULL, r.work_email
       FROM resellers r
       WHERE LOWER(TRIM(r.work_email)) = ANY($1::text[])
         AND TRIM(r.work_email) <> ''
         AND ($5::uuid IS NULL OR r.id <> $5)
       UNION ALL
       SELECT 'reseller_invoice_email', NULL, r.invoice_email
       FROM resellers r
       WHERE LOWER(TRIM(r.invoice_email)) = ANY($1::text[])
         AND TRIM(r.invoice_email) <> ''
         AND ($5::uuid IS NULL OR r.id <> $5)
       UNION ALL
       SELECT 'reseller_user_email', NULL, ru.email
       FROM reseller_users ru
       WHERE LOWER(TRIM(ru.email)) = ANY($1::text[])
         AND ($5::uuid IS NULL OR ru.reseller_id <> $5)
       UNION ALL
       SELECT 'org_work_email', o.source_lead_id, o.work_email
       FROM organizations o
       WHERE LOWER(TRIM(o.work_email)) = ANY($1::text[])
         AND TRIM(o.work_email) <> ''
         AND ($2::uuid IS NULL OR o.source_lead_id IS DISTINCT FROM $2)
         AND (
           o.source_lead_id IS NULL
           OR EXISTS (SELECT 1 FROM leads l WHERE l.id = o.source_lead_id)
         )
       UNION ALL
       SELECT 'org_admin_email', o.source_lead_id, o.admin_email
       FROM organizations o
       WHERE LOWER(TRIM(o.admin_email)) = ANY($1::text[])
         AND TRIM(o.admin_email) <> ''
         AND ($2::uuid IS NULL OR o.source_lead_id IS DISTINCT FROM $2)
         AND (
           o.source_lead_id IS NULL
           OR EXISTS (SELECT 1 FROM leads l WHERE l.id = o.source_lead_id)
         )
       UNION ALL
       SELECT 'org_location_work_email', o.source_lead_id, ol.work_email
       FROM organization_locations ol
       INNER JOIN organizations o ON o.id = ol.organization_id
       WHERE LOWER(TRIM(ol.work_email)) = ANY($1::text[])
         AND TRIM(ol.work_email) <> ''
         AND ($2::uuid IS NULL OR o.source_lead_id IS DISTINCT FROM $2)
         AND (
           o.source_lead_id IS NULL
           OR EXISTS (SELECT 1 FROM leads l WHERE l.id = o.source_lead_id)
         )`,
      [
        normalizedEmails,
        ignoreLeadId,
        ignoreUserId,
        ignorePartnerId,
        ignoreResellerId,
      ],
    );
    conflicts.push(...rows);
  }

  if (normalizedPhones.length) {
    const { rows } = await query(
      `SELECT 'lead_mobile' AS source, l.id AS lead_id, ${phoneDigitsSql("l")} AS value
       FROM leads l
       WHERE ${phoneDigitsSql("l")} = ANY($1::text[])
         AND ${phoneDigitsSql("l")} <> ''
         AND ($2::uuid IS NULL OR l.id <> $2)
       UNION ALL
       SELECT 'lead_secondary_mobile', l.id, ${phoneDigitsSql("l")}
       FROM leads l
       WHERE regexp_replace(
         COALESCE(l.secondary_mobile_country_code, '') || COALESCE(l.secondary_mobile_number, ''),
         '\\D', '', 'g'
       ) = ANY($1::text[])
         AND regexp_replace(
           COALESCE(l.secondary_mobile_country_code, '') || COALESCE(l.secondary_mobile_number, ''),
           '\\D', '', 'g'
         ) <> ''
         AND ($2::uuid IS NULL OR l.id <> $2)
       UNION ALL
       SELECT 'branch_mobile', aa.lead_id, ${phoneDigitsSql("aa")}
       FROM additional_addresses aa
       WHERE ${phoneDigitsSql("aa")} = ANY($1::text[])
         AND ${phoneDigitsSql("aa")} <> ''
         AND ($2::uuid IS NULL OR aa.lead_id <> $2)
       UNION ALL
       SELECT 'branch_secondary_mobile', aa.lead_id,
         regexp_replace(
           COALESCE(aa.secondary_mobile_country_code, '') || COALESCE(aa.secondary_mobile_number, ''),
           '\\D', '', 'g'
         )
       FROM additional_addresses aa
       WHERE regexp_replace(
         COALESCE(aa.secondary_mobile_country_code, '') || COALESCE(aa.secondary_mobile_number, ''),
         '\\D', '', 'g'
       ) = ANY($1::text[])
         AND regexp_replace(
           COALESCE(aa.secondary_mobile_country_code, '') || COALESCE(aa.secondary_mobile_number, ''),
           '\\D', '', 'g'
         ) <> ''
         AND ($2::uuid IS NULL OR aa.lead_id <> $2)
       UNION ALL
       SELECT 'staff_mobile', NULL,
         regexp_replace(
           COALESCE(u.mobile_country_code, '') || COALESCE(u.mobile_number, ''),
           '\\D', '', 'g'
         )
       FROM users u
       WHERE regexp_replace(
         COALESCE(u.mobile_country_code, '') || COALESCE(u.mobile_number, ''),
         '\\D', '', 'g'
       ) = ANY($1::text[])
         AND regexp_replace(
           COALESCE(u.mobile_country_code, '') || COALESCE(u.mobile_number, ''),
           '\\D', '', 'g'
         ) <> ''
         AND ($3::uuid IS NULL OR u.id <> $3)
       UNION ALL
       SELECT 'staff_phone', NULL, regexp_replace(COALESCE(u.phone, ''), '\\D', '', 'g')
       FROM users u
       WHERE regexp_replace(COALESCE(u.phone, ''), '\\D', '', 'g') = ANY($1::text[])
         AND regexp_replace(COALESCE(u.phone, ''), '\\D', '', 'g') <> ''
         AND ($3::uuid IS NULL OR u.id <> $3)
       UNION ALL
       SELECT 'partner_mobile', NULL,
         regexp_replace(
           COALESCE(p.mobile_country_code, '') || COALESCE(p.mobile_number, ''),
           '\\D', '', 'g'
         )
       FROM partners p
       WHERE regexp_replace(
         COALESCE(p.mobile_country_code, '') || COALESCE(p.mobile_number, ''),
         '\\D', '', 'g'
       ) = ANY($1::text[])
         AND regexp_replace(
           COALESCE(p.mobile_country_code, '') || COALESCE(p.mobile_number, ''),
           '\\D', '', 'g'
         ) <> ''
         AND ($4::uuid IS NULL OR p.id <> $4)
       UNION ALL
       SELECT 'reseller_mobile', NULL,
         regexp_replace(
           COALESCE(r.mobile_country_code, '') || COALESCE(r.mobile_number, ''),
           '\\D', '', 'g'
         )
       FROM resellers r
       WHERE regexp_replace(
         COALESCE(r.mobile_country_code, '') || COALESCE(r.mobile_number, ''),
         '\\D', '', 'g'
       ) = ANY($1::text[])
         AND regexp_replace(
           COALESCE(r.mobile_country_code, '') || COALESCE(r.mobile_number, ''),
           '\\D', '', 'g'
         ) <> ''
         AND ($5::uuid IS NULL OR r.id <> $5)`,
      [
        normalizedPhones,
        ignoreLeadId,
        ignoreUserId,
        ignorePartnerId,
        ignoreResellerId,
      ],
    );
    conflicts.push(...rows);
  }

  return conflicts;
}

export async function findTaxNumberUsages(taxNumber: any, { ignoreLeadId = null }: any = {}) {
  const normalizedTax = String(taxNumber || "").trim().toUpperCase();
  if (!normalizedTax) {
    return [];
  }

  const { rows } = await query(
    `SELECT l.id AS lead_id, COALESCE(l.state, '') AS state, 'hq' AS scope, l.tax_number AS tax_number
     FROM leads l
     WHERE UPPER(TRIM(l.tax_number)) = $1
       AND ($2::uuid IS NULL OR l.id <> $2)
     UNION ALL
     SELECT aa.lead_id, COALESCE(aa.state, ''), 'branch', aa.tax_number
     FROM additional_addresses aa
     WHERE UPPER(TRIM(aa.tax_number)) = $1
       AND ($2::uuid IS NULL OR aa.lead_id <> $2)
     UNION ALL
     SELECT b.lead_id, COALESCE(b.state, ''), 'branch', b.tax_number
     FROM branches b
     WHERE UPPER(TRIM(b.tax_number)) = $1
       AND ($2::uuid IS NULL OR b.lead_id <> $2)`,
    [normalizedTax, ignoreLeadId],
  );

  return rows;
}
