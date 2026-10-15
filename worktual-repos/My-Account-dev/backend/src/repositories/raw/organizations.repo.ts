function runnerQuery(runner: any) {
  if (typeof runner?.query === "function") {
    return runner;
  }
  throw new Error("A database client or pool is required.");
}

export async function selectOrganizationLocations(runner: any, organizationId: any) {
  const { rows } = await runnerQuery(runner).query(
    `SELECT * FROM organization_locations WHERE organization_id = $1 ORDER BY is_primary DESC, label`,
    [organizationId],
  );
  return rows;
}

export async function selectOrganizationById(runner: any, organizationId: any) {
  const { rows } = await runnerQuery(runner).query(`SELECT * FROM organizations WHERE id = $1`, [
    organizationId,
  ]);
  return rows[0] || null;
}

export async function selectOrganizationByLeadId(runner: any, leadId: any) {
  const { rows } = await runnerQuery(runner).query(
    `SELECT * FROM organizations WHERE source_lead_id = $1 LIMIT 1`,
    [leadId],
  );
  return rows[0] || null;
}

export async function selectAllOrganizations(runner: any) {
  const { rows } = await runnerQuery(runner).query(
    `SELECT * FROM organizations ORDER BY converted_at DESC NULLS LAST, company_name`,
  );
  return rows;
}

export async function selectLeadContactForBranchCopy(runner: any, leadId: any) {
  const { rows } = await runnerQuery(runner).query(
    `SELECT contact_name, designation, work_email, admin_email,
            industry_type, mobile_country_code, mobile_number,
            secondary_mobile_country_code, secondary_mobile_number
     FROM leads WHERE id = $1`,
    [leadId],
  );
  return rows[0] || null;
}

export async function selectAdditionalAddressesForBranchCopy(runner: any, leadId: any) {
  const { rows } = await runnerQuery(runner).query(
    `SELECT id, contact_name, designation, work_email, industry_type,
            mobile_country_code, mobile_number,
            secondary_mobile_country_code, secondary_mobile_number
     FROM additional_addresses WHERE lead_id = $1`,
    [leadId],
  );
  return rows;
}

export async function selectBranchesForLead(runner: any, leadId: any) {
  const { rows } = await runnerQuery(runner).query(
    `SELECT id, label, address, country, tax_number, is_primary FROM branches WHERE lead_id = $1`,
    [leadId],
  );
  return rows;
}

export async function selectLeadBillingFallback(runner: any, leadId: any) {
  const { rows } = await runnerQuery(runner).query(
    `SELECT billing_address, country, tax_number, contact_name, designation, admin_email, work_email,
            industry_type, mobile_country_code, mobile_number,
            secondary_mobile_country_code, secondary_mobile_number
     FROM leads WHERE id = $1`,
    [leadId],
  );
  return rows[0] || null;
}

export async function upsertOrganizationLocation(runner: any, values: any) {
  await runnerQuery(runner).query(
    `INSERT INTO organization_locations (
       id, organization_id, label, address, country, tax_number, contact_name, designation, work_email,
       industry_type, mobile_country_code, mobile_number,
       secondary_mobile_country_code, secondary_mobile_number, is_primary
     )
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)
     ON CONFLICT (organization_id, id) DO UPDATE SET
       label = EXCLUDED.label,
       address = EXCLUDED.address,
       country = EXCLUDED.country,
       tax_number = EXCLUDED.tax_number,
       contact_name = EXCLUDED.contact_name,
       designation = EXCLUDED.designation,
       work_email = EXCLUDED.work_email,
       industry_type = EXCLUDED.industry_type,
       mobile_country_code = EXCLUDED.mobile_country_code,
       mobile_number = EXCLUDED.mobile_number,
       secondary_mobile_country_code = EXCLUDED.secondary_mobile_country_code,
       secondary_mobile_number = EXCLUDED.secondary_mobile_number,
       is_primary = EXCLUDED.is_primary`,
    values,
  );
}

export async function updateLeadConvertedOrganization(runner: any, leadId: any, organizationId: any, { setConvertedAt = false }: any = {}) {
  if (setConvertedAt) {
    await runnerQuery(runner).query(
      `UPDATE leads
       SET converted_organization_id = $2,
           converted_at = NOW(),
           updated_at = NOW()
       WHERE id = $1`,
      [leadId, organizationId],
    );
    return;
  }

  await runnerQuery(runner).query(
    `UPDATE leads
     SET converted_organization_id = $2,
         converted_at = COALESCE(converted_at, NOW()),
         updated_at = NOW()
     WHERE id = $1`,
    [leadId, organizationId],
  );
}

export async function insertOrganization(runner: any, values: any, { lifecycleStatus = "active" }: any = {}) {
  const status = lifecycleStatus === "prospect" ? "prospect" : "active";
  const { rows } = await runnerQuery(runner).query(
    `INSERT INTO organizations (
      source_lead_id, tenant_id, company_name, industry_type, contact_name, designation,
      work_email, admin_email, tax_number, billing_address, website_url, country,
      company_size, mobile_country_code, mobile_number, reseller_id, lifecycle_status, converted_at
    ) VALUES (
      $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17, NOW()
    )
    RETURNING *`,
    [...values, status],
  );
  return rows[0] || null;
}

export async function updateOrganizationSourceLead(runner: any, organizationId: any, leadId: any) {
  await runnerQuery(runner).query(
    `UPDATE organizations
     SET source_lead_id = $2, updated_at = NOW()
     WHERE id = $1`,
    [organizationId, leadId],
  );
}

/** Sync org profile fields from the source lead so portal Account contact matches sales. */
export async function updateOrganizationProfileFromLead(runner: any, organizationId: any, values: any) {
  await runnerQuery(runner).query(
    `UPDATE organizations
     SET company_name = $2,
         industry_type = $3,
         contact_name = $4,
         designation = $5,
         work_email = $6,
         admin_email = $7,
         tax_number = $8,
         billing_address = $9,
         website_url = $10,
         country = $11,
         company_size = $12,
         mobile_country_code = $13,
         mobile_number = $14,
         updated_at = NOW()
     WHERE id = $1`,
    [organizationId, ...values],
  );
}

export async function activateOrganization(runner: any, organizationId: any) {
  const { rows } = await runnerQuery(runner).query(
    `UPDATE organizations
     SET lifecycle_status = 'active',
         converted_at = COALESCE(converted_at, NOW()),
         updated_at = NOW()
     WHERE id = $1
     RETURNING *`,
    [organizationId],
  );
  return rows[0] || null;
}

export async function updateLeadOrganizationId(runner: any, leadId: any, organizationId: any) {
  await runnerQuery(runner).query(
    `UPDATE leads
     SET organization_id = $2, updated_at = NOW()
     WHERE id = $1`,
    [leadId, organizationId],
  );
}
