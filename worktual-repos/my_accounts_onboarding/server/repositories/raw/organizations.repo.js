function runnerQuery(runner) {
  if (typeof runner?.query === "function") {
    return runner;
  }
  throw new Error("A database client or pool is required.");
}

export async function selectOrganizationLocations(runner, organizationId) {
  const { rows } = await runnerQuery(runner).query(
    `SELECT * FROM organization_locations WHERE organization_id = $1 ORDER BY is_primary DESC, label`,
    [organizationId],
  );
  return rows;
}

export async function selectOrganizationById(runner, organizationId) {
  const { rows } = await runnerQuery(runner).query(`SELECT * FROM organizations WHERE id = $1`, [
    organizationId,
  ]);
  return rows[0] || null;
}

export async function selectOrganizationByLeadId(runner, leadId) {
  const { rows } = await runnerQuery(runner).query(
    `SELECT * FROM organizations WHERE source_lead_id = $1 LIMIT 1`,
    [leadId],
  );
  return rows[0] || null;
}

export async function selectAllOrganizations(runner) {
  const { rows } = await runnerQuery(runner).query(
    `SELECT * FROM organizations ORDER BY converted_at DESC NULLS LAST, company_name`,
  );
  return rows;
}

export async function selectLeadContactForBranchCopy(runner, leadId) {
  const { rows } = await runnerQuery(runner).query(
    `SELECT contact_name, designation, work_email, admin_email FROM leads WHERE id = $1`,
    [leadId],
  );
  return rows[0] || null;
}

export async function selectAdditionalAddressesForBranchCopy(runner, leadId) {
  const { rows } = await runnerQuery(runner).query(
    `SELECT id, contact_name, designation, work_email FROM additional_addresses WHERE lead_id = $1`,
    [leadId],
  );
  return rows;
}

export async function selectBranchesForLead(runner, leadId) {
  const { rows } = await runnerQuery(runner).query(
    `SELECT id, label, address, country, tax_number, is_primary FROM branches WHERE lead_id = $1`,
    [leadId],
  );
  return rows;
}

export async function selectLeadBillingFallback(runner, leadId) {
  const { rows } = await runnerQuery(runner).query(
    `SELECT billing_address, country, tax_number, contact_name, designation, admin_email, work_email FROM leads WHERE id = $1`,
    [leadId],
  );
  return rows[0] || null;
}

export async function upsertOrganizationLocation(runner, values) {
  await runnerQuery(runner).query(
    `INSERT INTO organization_locations (
       id, organization_id, label, address, country, tax_number, contact_name, designation, work_email, is_primary
     )
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
     ON CONFLICT (organization_id, id) DO UPDATE SET
       label = EXCLUDED.label,
       address = EXCLUDED.address,
       country = EXCLUDED.country,
       tax_number = EXCLUDED.tax_number,
       contact_name = EXCLUDED.contact_name,
       designation = EXCLUDED.designation,
       work_email = EXCLUDED.work_email,
       is_primary = EXCLUDED.is_primary`,
    values,
  );
}

export async function updateLeadConvertedOrganization(runner, leadId, organizationId, { setConvertedAt = false } = {}) {
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

export async function insertOrganization(runner, values) {
  const { rows } = await runnerQuery(runner).query(
    `INSERT INTO organizations (
      source_lead_id, domain_id, company_name, industry_type, business_type, contact_name, designation,
      work_email, admin_email, tax_number, billing_address, website_url, country,
      company_size, mobile_country_code, mobile_number, lifecycle_status, converted_at
    ) VALUES (
      $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,'active', NOW()
    )
    RETURNING *`,
    values,
  );
  return rows[0] || null;
}
