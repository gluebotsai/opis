function runnerQuery(runner) {
  if (typeof runner?.query === "function") {
    return runner;
  }
  throw new Error("A database client or pool is required.");
}

export async function selectAllDomainIds(runner) {
  const { rows } = await runnerQuery(runner).query(`SELECT domain_id FROM leads`);
  return rows;
}

export async function selectLeads(runner, { createdByUserId = null, pipelineOnly = false } = {}) {
  const conditions = [];
  const params = [];

  if (createdByUserId) {
    params.push(createdByUserId);
    conditions.push(`created_by_user_id = $${params.length}`);
  }

  if (pipelineOnly) {
    conditions.push(`converted_organization_id IS NULL`);
  }

  const whereClause = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";
  const { rows } = await runnerQuery(runner).query(
    `SELECT * FROM leads ${whereClause} ORDER BY created_at DESC`,
    params,
  );
  return rows;
}

export async function selectLeadById(runner, leadId) {
  const { rows } = await runnerQuery(runner).query(`SELECT * FROM leads WHERE id = $1`, [leadId]);
  return rows[0] || null;
}

export async function selectLeadOwnershipRow(runner, leadId) {
  const { rows } = await runnerQuery(runner).query(
    `SELECT id, assigned_user_id, created_by_user_id FROM leads WHERE id = $1`,
    [leadId],
  );
  return rows[0] || null;
}

export async function selectSubscriptionsForLead(runner, leadId) {
  const { rows } = await runnerQuery(runner).query(
    `SELECT * FROM subscriptions WHERE source_lead_id = $1 ORDER BY product_id, location_id`,
    [leadId],
  );
  return rows;
}

export async function selectActiveProductsForLead(runner, leadId) {
  const { rows } = await runnerQuery(runner).query(
    `SELECT * FROM active_products WHERE lead_id = $1 ORDER BY approved_at DESC NULLS LAST`,
    [leadId],
  );
  return rows;
}

export async function selectAdditionalAddressesForLead(runner, leadId) {
  const { rows } = await runnerQuery(runner).query(
    `SELECT id, label, address, country, tax_number, industry_type, business_type, company_size,
            website_url, contact_name, designation, work_email,
            mobile_country_code, mobile_number, secondary_mobile_country_code, secondary_mobile_number
     FROM additional_addresses WHERE lead_id = $1 ORDER BY label`,
    [leadId],
  );
  return rows;
}

export async function selectLatestQuotationMetaForLead(runner, leadId) {
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

export async function upsertBranchRow(runner, values) {
  await runnerQuery(runner).query(
    `INSERT INTO branches (id, lead_id, label, address, country, tax_number, is_primary)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     ON CONFLICT (lead_id, id) DO UPDATE SET
       label = EXCLUDED.label,
       address = EXCLUDED.address,
       country = EXCLUDED.country,
       tax_number = EXCLUDED.tax_number,
       is_primary = EXCLUDED.is_primary`,
    values,
  );
}

export async function deleteAdditionalAddressesExcept(runner, leadId, retainedIds) {
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

export async function upsertAdditionalAddressRow(runner, values) {
  await runnerQuery(runner).query(
    `INSERT INTO additional_addresses (
       id, lead_id, label, address, country, tax_number, industry_type, business_type, company_size,
       website_url, contact_name, designation, work_email,
       mobile_country_code, mobile_number, secondary_mobile_country_code, secondary_mobile_number
     )
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17)
     ON CONFLICT (id) DO UPDATE SET
       lead_id = EXCLUDED.lead_id,
       label = EXCLUDED.label,
       address = EXCLUDED.address,
       country = EXCLUDED.country,
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

export async function insertLeadRow(runner, values) {
  const { rows } = await runnerQuery(runner).query(
    `INSERT INTO leads (
      id, company_name, industry_type, business_type, contact_name, designation, work_email, admin_email,
      tax_number, billing_address, website_url, country, company_size, is_decision_maker,
      decision_maker_name, mobile_country_code, mobile_number,
      secondary_mobile_country_code, secondary_mobile_number, status, is_active, domain_id,
      assigned_user_id, created_by_user_id, assigned_at,
      created_at, updated_at
    ) VALUES (
      gen_random_uuid(), $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24, NOW(), NOW()
    )
    RETURNING *`,
    values,
  );
  return rows[0] || null;
}

export async function insertLeadAssignmentRow(runner, values) {
  await runnerQuery(runner).query(
    `INSERT INTO lead_assignments (lead_id, from_user_id, to_user_id, assigned_by_user_id, reason)
     VALUES ($1, $2, $3, $4, $5)`,
    values,
  );
}

export async function selectLeadAssignedUserId(runner, leadId) {
  const { rows } = await runnerQuery(runner).query(
    `SELECT assigned_user_id FROM leads WHERE id = $1`,
    [leadId],
  );
  return rows[0] || null;
}

export async function updateLeadAssignment(runner, leadId, toUserId) {
  await runnerQuery(runner).query(
    `UPDATE leads
     SET assigned_user_id = $2, assigned_at = NOW(), updated_at = NOW()
     WHERE id = $1`,
    [leadId, toUserId],
  );
}

export async function updateLeadRow(runner, values) {
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
      company_size = $13,
      is_decision_maker = $14,
      decision_maker_name = $15,
      mobile_country_code = $16,
      mobile_number = $17,
      secondary_mobile_country_code = $18,
      secondary_mobile_number = $19,
      status = $20,
      is_active = $21,
      product_draft = $22,
      updated_at = NOW()
     WHERE id = $1`,
    values,
  );
}

export async function updateLeadStatusRaw(runner, leadId, status) {
  await runnerQuery(runner).query(`UPDATE leads SET status = $2, updated_at = NOW() WHERE id = $1`, [
    leadId,
    status,
  ]);
}
