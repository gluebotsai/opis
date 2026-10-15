import { pool } from "../../db/pool.js";
import { rowToCamel, toIso } from "../../db/util.js";
import { HQ_BRANCH_ID } from "../leads/lead-store.js";
import { selectLeadById } from "../../repositories/raw/leads.repo.js";
import {
  activateOrganization,
  insertOrganization,
  selectAdditionalAddressesForBranchCopy,
  selectAllOrganizations,
  selectBranchesForLead,
  selectLeadBillingFallback,
  selectLeadContactForBranchCopy,
  selectOrganizationById,
  selectOrganizationByLeadId,
  selectOrganizationLocations,
  updateLeadConvertedOrganization,
  updateOrganizationProfileFromLead,
  updateOrganizationSourceLead,
  upsertOrganizationLocation,
} from "../../repositories/raw/organizations.repo.js";

function mapOrganizationRow(row: any, locations = []) {
  const org = rowToCamel(row);
  return {
    id: (org as any).id,
    sourceLeadId: (org as any).sourceLeadId,
    tenantId: (org as any).tenantId,
    companyName: (org as any).companyName || "",
    industryType: (org as any).industryType || "",
    contactName: (org as any).contactName || "",
    designation: (org as any).designation || "",
    workEmail: (org as any).workEmail || "",
    adminEmail: (org as any).adminEmail || "",
    taxNumber: (org as any).taxNumber || "",
    billingAddress: (org as any).billingAddress || "",
    websiteUrl: (org as any).websiteUrl || "",
    country: (org as any).country || "",
    companySize: (org as any).companySize || "",
    mobileCountryCode: (org as any).mobileCountryCode || "+91",
    mobileNumber: (org as any).mobileNumber || "",
    lifecycleStatus: (org as any).lifecycleStatus || "active",
    convertedAt: toIso((org as any).convertedAt),
    createdAt: toIso((org as any).createdAt),
    updatedAt: toIso((org as any).updatedAt),
    locations,
  };
}

function mapOrganizationLocations(rows: any) {
  return rows.map((row: any) => {
    const entry = rowToCamel(row);
    return {
      id: (entry as any).id,
      label: (entry as any).label || "",
      address: (entry as any).address || "",
      isPrimary: (entry as any).isPrimary === true,
      country: (entry as any).country || "",
      taxNumber: (entry as any).taxNumber || "",
      contactName: (entry as any).contactName || "",
      designation: (entry as any).designation || "",
      workEmail: (entry as any).workEmail || "",
      industryType: (entry as any).industryType || "",
      mobileCountryCode: (entry as any).mobileCountryCode || "",
      mobileNumber: (entry as any).mobileNumber || "",
      secondaryMobileCountryCode: (entry as any).secondaryMobileCountryCode || "",
      secondaryMobileNumber: (entry as any).secondaryMobileNumber || "",
      status: (entry as any).status || "active",
      inactivatedAt: toIso((entry as any).inactivatedAt),
      scheduledDropAt: toIso((entry as any).scheduledDropAt),
    };
  });
}

async function loadOrganizationLocations(client: any, organizationId: any) {
  const rows = await selectOrganizationLocations(client, organizationId);
  return mapOrganizationLocations(rows);
}

async function hydrateOrganization(client: any, row: any) {
  const locations = await loadOrganizationLocations(client, row.id);
  return mapOrganizationRow(row, locations);
}

export async function getOrganizationById(organizationId: any, client = null) {
  const runner = client || pool;
  const row = await selectOrganizationById(runner, organizationId);

  if (!row) {
    return null;
  }

  if (client) {
    return hydrateOrganization(client, row);
  }

  const dbClient = await pool.connect();
  try {
    return hydrateOrganization(dbClient, row);
  } finally {
    dbClient.release();
  }
}

export async function getOrganizationByLeadId(leadId: any, client = null) {
  const runner = client || pool;
  const row = await selectOrganizationByLeadId(runner, leadId);

  if (!row) {
    return null;
  }

  if (client) {
    return hydrateOrganization(client, row);
  }

  const dbClient = await pool.connect();
  try {
    return hydrateOrganization(dbClient, row);
  } finally {
    dbClient.release();
  }
}

export async function listOrganizations() {
  const client = await pool.connect();
  try {
    const rows = await selectAllOrganizations(client);
    const organizations = [];

    for (const row of rows) {
      organizations.push(await hydrateOrganization(client, row));
    }

    return organizations;
  } finally {
    client.release();
  }
}

async function loadBranchContactsByLead(client: any, leadId: any) {
  const contacts = new Map();

  const lead = await selectLeadContactForBranchCopy(client, leadId);
  if (lead) {
    contacts.set("hq", {
      contactName: lead.contact_name || "",
      designation: lead.designation || "",
      // Location "work email" must match the lead work email sales entered — never prefer admin_email.
      workEmail: lead.work_email || "",
      industryType: lead.industry_type || "",
      mobileCountryCode: lead.mobile_country_code || "",
      mobileNumber: lead.mobile_number || "",
      secondaryMobileCountryCode: lead.secondary_mobile_country_code || "",
      secondaryMobileNumber: lead.secondary_mobile_number || "",
    });
  }

  const addressRows = await selectAdditionalAddressesForBranchCopy(client, leadId);

  for (const row of addressRows) {
    contacts.set(row.id, {
      contactName: row.contact_name || "",
      designation: row.designation || "",
      workEmail: row.work_email || "",
      industryType: row.industry_type || "",
      mobileCountryCode: row.mobile_country_code || "",
      mobileNumber: row.mobile_number || "",
      secondaryMobileCountryCode: row.secondary_mobile_country_code || "",
      secondaryMobileNumber: row.secondary_mobile_number || "",
    });
  }

  return contacts;
}

function organizationLocationValuesFromBranch(row: any, organizationId: any, contact: any = {}) {
  return [
    row.id,
    organizationId,
    row.label,
    row.address,
    row.country || null,
    row.tax_number || null,
    contact.contactName || "",
    contact.designation || "",
    contact.workEmail || "",
    contact.industryType || "",
    contact.mobileCountryCode || null,
    contact.mobileNumber || null,
    contact.secondaryMobileCountryCode || null,
    contact.secondaryMobileNumber || null,
    row.is_primary,
  ];
}

async function copyLeadLocationsToOrganization(client: any, leadId: any, organizationId: any) {
  const contacts = await loadBranchContactsByLead(client, leadId);
  const rows = await selectBranchesForLead(client, leadId);

  if (rows.length === 0) {
    const leadRow = await selectLeadBillingFallback(client, leadId);
    const billingAddress = String(leadRow?.billing_address || "").trim();
    if (billingAddress) {
      const contact = contacts.get("hq") || {};
      await upsertOrganizationLocation(
        client,
        organizationLocationValuesFromBranch(
          {
            id: HQ_BRANCH_ID,
            label: "Head office",
            address: billingAddress,
            country: leadRow?.country || null,
            tax_number: leadRow?.tax_number || null,
            is_primary: true,
          },
          organizationId,
          {
            ...contact,
            industryType: contact.industryType || leadRow?.industry_type || "",
            mobileCountryCode: contact.mobileCountryCode || leadRow?.mobile_country_code || "",
            mobileNumber: contact.mobileNumber || leadRow?.mobile_number || "",
            secondaryMobileCountryCode:
              contact.secondaryMobileCountryCode || leadRow?.secondary_mobile_country_code || "",
            secondaryMobileNumber:
              contact.secondaryMobileNumber || leadRow?.secondary_mobile_number || "",
          },
        ),
      );
    }
    return;
  }

  for (const row of rows) {
    const contact = contacts.get(row.id) || contacts.get("hq") || {};
    await upsertOrganizationLocation(
      client,
      organizationLocationValuesFromBranch(row, organizationId, contact),
    );
  }
}

/** Keep organization profile emails/contact in sync with the source lead (portal reads org, sales reads lead). */
export async function syncOrganizationProfileFromLead(client: any, leadId: any, organizationId: any) {
  const leadRow = await selectLeadById(client, leadId);
  if (!leadRow || !organizationId) {
    return null;
  }
  const lead = rowToCamel(leadRow);
  await updateOrganizationProfileFromLead(client, organizationId, [
    (lead as any).companyName || "",
    (lead as any).industryType || "",
    (lead as any).contactName || "",
    (lead as any).designation || "",
    (lead as any).workEmail || "",
    (lead as any).adminEmail || "",
    (lead as any).taxNumber || "",
    (lead as any).billingAddress || "",
    (lead as any).websiteUrl || "",
    (lead as any).country || "",
    (lead as any).companySize || "",
    (lead as any).mobileCountryCode || "+91",
    (lead as any).mobileNumber || "",
  ]);
  await copyLeadLocationsToOrganization(client, leadId, organizationId);
  return loadOrganizationLocations(client, organizationId);
}

export async function refreshOrganizationLocationsFromLead(client: any, leadId: any, organizationId: any) {
  // Also refresh org-level work/admin email so portal Account contact matches the lead.
  return syncOrganizationProfileFromLead(client, leadId, organizationId);
}

function organizationInsertValuesFromLead(lead: any, sourceLeadId = null) {
  return [
    sourceLeadId,
    lead.tenantId,
    lead.companyName || "",
    lead.industryType || "",
    lead.contactName || "",
    lead.designation || "",
    lead.workEmail || "",
    lead.adminEmail || "",
    lead.taxNumber || "",
    lead.billingAddress || "",
    lead.websiteUrl || "",
    lead.country || "",
    lead.companySize || "",
    lead.mobileCountryCode || "+91",
    lead.mobileNumber || "",
    lead.resellerId || null,
  ];
}

/**
 * Create a prospect organization for a new lead (multi-tenancy root).
 * Caller should pass lead field snapshot before or after lead insert.
 */
export async function createProspectOrganization(client: any, leadFields: any, { sourceLeadId = null } = {}) {
  const orgRow = await insertOrganization(
    client,
    organizationInsertValuesFromLead(leadFields, sourceLeadId),
    { lifecycleStatus: "prospect" },
  );
  return hydrateOrganization(client, orgRow);
}

/**
 * Convert a lead into a customer organization on first paid purchase.
 * Idempotent — returns existing organization if already converted.
 * Activates prospect orgs created at lead creation.
 */
export async function convertLeadToOrganization(leadId: any, client: any) {
  const existingOrgRow = await selectOrganizationByLeadId(client, leadId);

  if (existingOrgRow) {
    const activated =
      existingOrgRow.lifecycle_status === "active"
        ? existingOrgRow
        : (await activateOrganization(client, existingOrgRow.id)) || existingOrgRow;
    await updateLeadConvertedOrganization(client, leadId, activated.id, { setConvertedAt: true });
    await syncOrganizationProfileFromLead(client, leadId, activated.id);
    const org = await hydrateOrganization(client, await selectOrganizationById(client, activated.id));
    return { organization: org, created: false };
  }

  const leadRow = await selectLeadById(client, leadId);
  if (!leadRow) {
    throw new Error(`Lead not found: ${leadId}`);
  }

  const lead = rowToCamel(leadRow);

  if ((lead as any).organizationId) {
    const activated = await activateOrganization(client, (lead as any).organizationId);
    await updateOrganizationSourceLead(client, (lead as any).organizationId, leadId);
    await updateLeadConvertedOrganization(client, leadId, (lead as any).organizationId, {
      setConvertedAt: true,
    });
    await syncOrganizationProfileFromLead(client, leadId, (lead as any).organizationId);
    const org = await hydrateOrganization(
      client,
      activated || (await selectOrganizationById(client, (lead as any).organizationId)),
    );
    return { organization: org, created: false };
  }

  const orgRow = await insertOrganization(
    client,
    organizationInsertValuesFromLead(lead, leadId),
    { lifecycleStatus: "active" },
  );

  const organization = await hydrateOrganization(client, orgRow);
  await copyLeadLocationsToOrganization(client, leadId, organization.id);

  await updateLeadConvertedOrganization(client, leadId, organization.id, { setConvertedAt: true });
  await client.query(`UPDATE leads SET organization_id = $2, updated_at = NOW() WHERE id = $1`, [
    leadId,
    organization.id,
  ]);

  organization.locations = await loadOrganizationLocations(client, organization.id);
  return { organization, created: true };
}

export async function ensureOrganizationForPaidLead(leadId: any, client: any) {
  return convertLeadToOrganization(leadId, client);
}
