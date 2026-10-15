import { pool } from "./db/pool.js";
import { rowToCamel, toIso } from "./db/util.js";
import { HQ_BRANCH_ID } from "./leads.js";
import { selectLeadById } from "./repositories/raw/leads.repo.js";
import {
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
  upsertOrganizationLocation,
} from "./repositories/raw/organizations.repo.js";

function mapOrganizationRow(row, locations = []) {
  const org = rowToCamel(row);
  return {
    id: org.id,
    sourceLeadId: org.sourceLeadId,
    domainId: org.domainId,
    companyName: org.companyName || "",
    industryType: org.industryType || "",
    contactName: org.contactName || "",
    designation: org.designation || "",
    workEmail: org.workEmail || "",
    adminEmail: org.adminEmail || "",
    taxNumber: org.taxNumber || "",
    billingAddress: org.billingAddress || "",
    websiteUrl: org.websiteUrl || "",
    country: org.country || "",
    companySize: org.companySize || "",
    mobileCountryCode: org.mobileCountryCode || "+91",
    mobileNumber: org.mobileNumber || "",
    lifecycleStatus: org.lifecycleStatus || "active",
    convertedAt: toIso(org.convertedAt),
    createdAt: toIso(org.createdAt),
    updatedAt: toIso(org.updatedAt),
    locations,
  };
}

function mapOrganizationLocations(rows) {
  return rows.map((row) => {
    const entry = rowToCamel(row);
    return {
      id: entry.id,
      label: entry.label || "",
      address: entry.address || "",
      isPrimary: entry.isPrimary === true,
      country: entry.country || "",
      taxNumber: entry.taxNumber || "",
      contactName: entry.contactName || "",
      designation: entry.designation || "",
      workEmail: entry.workEmail || "",
      status: entry.status || "active",
      inactivatedAt: toIso(entry.inactivatedAt),
      scheduledDropAt: toIso(entry.scheduledDropAt),
    };
  });
}

async function loadOrganizationLocations(client, organizationId) {
  const rows = await selectOrganizationLocations(client, organizationId);
  return mapOrganizationLocations(rows);
}

async function hydrateOrganization(client, row) {
  const locations = await loadOrganizationLocations(client, row.id);
  return mapOrganizationRow(row, locations);
}

export async function getOrganizationById(organizationId, client = null) {
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

export async function getOrganizationByLeadId(leadId, client = null) {
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

async function loadBranchContactsByLead(client, leadId) {
  const contacts = new Map();

  const lead = await selectLeadContactForBranchCopy(client, leadId);
  if (lead) {
    contacts.set("hq", {
      contactName: lead.contact_name || "",
      designation: lead.designation || "",
      workEmail: lead.admin_email || lead.work_email || "",
    });
  }

  const addressRows = await selectAdditionalAddressesForBranchCopy(client, leadId);

  for (const row of addressRows) {
    contacts.set(row.id, {
      contactName: row.contact_name || "",
      designation: row.designation || "",
      workEmail: row.work_email || "",
    });
  }

  return contacts;
}

async function copyLeadLocationsToOrganization(client, leadId, organizationId) {
  const contacts = await loadBranchContactsByLead(client, leadId);
  const rows = await selectBranchesForLead(client, leadId);

  if (rows.length === 0) {
    const leadRow = await selectLeadBillingFallback(client, leadId);
    const billingAddress = String(leadRow?.billing_address || "").trim();
    if (billingAddress) {
      await upsertOrganizationLocation(client, [
        HQ_BRANCH_ID,
        organizationId,
        "Head office",
        billingAddress,
        leadRow?.country || null,
        leadRow?.tax_number || null,
        leadRow?.contact_name || "",
        leadRow?.designation || "",
        leadRow?.admin_email || leadRow?.work_email || "",
        true,
      ]);
    }
    return;
  }

  for (const row of rows) {
    const contact = contacts.get(row.id) || contacts.get("hq") || {};
    await upsertOrganizationLocation(client, [
      row.id,
      organizationId,
      row.label,
      row.address,
      row.country || null,
      row.tax_number || null,
      contact.contactName || "",
      contact.designation || "",
      contact.workEmail || "",
      row.is_primary,
    ]);
  }
}

export async function refreshOrganizationLocationsFromLead(client, leadId, organizationId) {
  await copyLeadLocationsToOrganization(client, leadId, organizationId);
  return loadOrganizationLocations(client, organizationId);
}

/**
 * Convert a lead into a customer organization on first paid purchase.
 * Idempotent — returns existing organization if already converted.
 */
export async function convertLeadToOrganization(leadId, client) {
  const existingOrgRow = await selectOrganizationByLeadId(client, leadId);

  if (existingOrgRow) {
    const org = await hydrateOrganization(client, existingOrgRow);
    await updateLeadConvertedOrganization(client, leadId, org.id);
    return { organization: org, created: false };
  }

  const leadRow = await selectLeadById(client, leadId);
  if (!leadRow) {
    throw new Error(`Lead not found: ${leadId}`);
  }

  const lead = rowToCamel(leadRow);

  const orgRow = await insertOrganization(client, [
    leadId,
    lead.domainId,
    lead.companyName || "",
    lead.industryType || "",
    lead.businessType || "",
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
  ]);

  const organization = await hydrateOrganization(client, orgRow);
  await copyLeadLocationsToOrganization(client, leadId, organization.id);

  await updateLeadConvertedOrganization(client, leadId, organization.id, { setConvertedAt: true });

  organization.locations = await loadOrganizationLocations(client, organization.id);
  return { organization, created: true };
}

export async function ensureOrganizationForPaidLead(leadId, client) {
  return convertLeadToOrganization(leadId, client);
}
