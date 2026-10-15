import { getAuthToken } from "./auth.js";
import { fetchJson } from "./http.js";

function authHeaders() {
  const token = getAuthToken();
  return token ? { Authorization: `Bearer ${token}` } : {};
}

export async function getLeads({ scope, pipelineOnly = false } = {}) {
  const params = new URLSearchParams();
  if (scope) {
    params.set("scope", scope);
  }
  if (pipelineOnly) {
    params.set("pipelineOnly", "true");
  }
  const query = params.toString() ? `?${params.toString()}` : "";
  const data = await fetchJson(`/api/leads${query}`, { headers: authHeaders() });
  return data.leads || [];
}

export async function getLeadById(id) {
  const data = await fetchJson(`/api/leads/${id}`, { headers: authHeaders() });
  return data.lead || null;
}

export async function createLead(payload) {
  const data = await fetchJson("/api/leads", {
    method: "POST",
    headers: { "Content-Type": "application/json", ...authHeaders() },
    body: JSON.stringify(payload),
  });
  return data.lead;
}

export async function updateLead(id, updates) {
  const data = await fetchJson(`/api/leads/${id}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json", ...authHeaders() },
    body: JSON.stringify(updates),
  });
  return data.lead;
}

export const HQ_BRANCH_ID = "hq";

export const BUSINESS_TYPE_OPTIONS = ["B2B", "B2C", "B2B & B2C"];

export const INDUSTRY_OTHER = "Other";

export const COUNTRY_OPTIONS = [
  "India",
  "United States",
  "United Kingdom",
  "Australia",
  "Singapore",
  "Canada",
  "United Arab Emirates",
  "Germany",
  "France",
  "Other",
];

export const COMPANY_SIZE_OPTIONS = [
  "1-10 employees",
  "11-50 employees",
  "51-200 employees",
  "201-500 employees",
  "500+ employees",
];

export const INDUSTRY_OPTIONS = [
  "Technology & Software",
  "Healthcare & Life Sciences",
  "Financial Services",
  "Retail & E-commerce",
  "Manufacturing",
  "Education",
  "Hospitality & Travel",
  "Real Estate",
  "Media & Entertainment",
  "Government & Public Sector",
  "Logistics & Transportation",
  INDUSTRY_OTHER,
];

export const LEAD_STATUSES = [
  "New",
  "In Progress",
  "Qualified",
  "Pending Finance Review",
  "Approved",
  "Paid",
  "Rejected",
];

export const LEAD_COLUMNS = [
  { key: "companyName", label: "Company Name", type: "text" },
  { key: "industryType", label: "Industry Type", type: "text" },
  { key: "businessType", label: "Business Type", type: "text" },
  { key: "contactName", label: "Contact Name", type: "text" },
  { key: "designation", label: "Designation", type: "text" },
  { key: "workEmail", label: "Work Email", type: "email" },
  { key: "mobileCountryCode", label: "Mobile Code", type: "text" },
  { key: "mobileNumber", label: "Mobile Number", type: "text" },
  { key: "secondaryMobileCountryCode", label: "Secondary Code", type: "text" },
  { key: "secondaryMobileNumber", label: "Secondary Mobile", type: "text" },
  { key: "billingAddress", label: "Billing Address", type: "text" },
  { key: "websiteUrl", label: "Website URL", type: "url" },
  { key: "country", label: "Country", type: "text" },
  { key: "companySize", label: "Company Size", type: "text" },
  { key: "decisionMakerName", label: "Decision Maker", type: "text" },
  { key: "adminEmail", label: "Admin Email", type: "email" },
  { key: "taxNumber", label: "GST / VAT Number", type: "text" },
];

export function formatLeadValue(lead, key) {
  return lead[key] ?? "";
}

export function leadSearchText(lead) {
  const extraAddresses = (lead.additionalAddresses || [])
    .map((entry) => `${entry.label} ${entry.address}`)
    .join(" ");

  return [
    lead.companyName,
    lead.contactName,
    lead.domainId,
    lead.industryType,
    lead.businessType,
    lead.country,
    lead.companySize,
    lead.decisionMakerName,
    lead.status,
    lead.billingAddress,
    lead.websiteUrl,
    extraAddresses,
  ]
    .join(" ")
    .toLowerCase();
}

export function formatLeadAddresses(lead) {
  return getLeadBranches(lead).map((branch) => ({
    id: branch.id,
    label: branch.label,
    address: branch.address,
    country: branch.country || "",
    taxNumber: branch.taxNumber || "",
    status: branch.status || "active",
    scheduledDropAt: branch.scheduledDropAt || null,
  }));
}

export function formatLeadCreatedDate(value) {
  return new Date(value).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

/** Normalized branch list: HQ (billing address) plus additional branch locations. */
export function getLeadBranches(lead) {
  if (!lead) {
    return [];
  }

  const leadCountry = String(lead.country || "").trim();
  const branches = [];
  const locationMetaById = new Map(
    (lead.organizationLocations || []).map((entry) => [
      String(entry.id),
      {
        status: entry.status || "active",
        scheduledDropAt: entry.scheduledDropAt || null,
      },
    ]),
  );

  if (String(lead.billingAddress || "").trim()) {
    branches.push({
      id: HQ_BRANCH_ID,
      label: "Head office",
      address: lead.billingAddress.trim(),
      country: leadCountry,
      taxNumber: String(lead.taxNumber || "").trim(),
      isPrimary: true,
      status: locationMetaById.get(HQ_BRANCH_ID)?.status || "active",
      scheduledDropAt: locationMetaById.get(HQ_BRANCH_ID)?.scheduledDropAt || null,
    });
  }

  for (const entry of lead.additionalAddresses || []) {
    if (!String(entry?.address || "").trim()) {
      continue;
    }

    branches.push({
      id: entry.id,
      label: String(entry.label || "").trim() || "Branch",
      address: String(entry.address || "").trim(),
      country: String(entry.country || "").trim() || leadCountry,
      taxNumber: String(entry.taxNumber || "").trim(),
      isPrimary: false,
      status: entry.status || locationMetaById.get(String(entry.id))?.status || "active",
      scheduledDropAt:
        entry.scheduledDropAt || locationMetaById.get(String(entry.id))?.scheduledDropAt || null,
    });
  }

  return branches;
}

/** Country for pricing/tax — HQ uses lead country; branches may differ. */
export function getBranchCountry(lead, branchId) {
  const branch = getBranchById(lead, branchId);
  if (branch?.country) {
    return branch.country;
  }

  return String(lead?.country || "").trim();
}

/** GST/VAT/tax ID for invoicing — HQ uses lead tax number; branches may differ. */
export function getBranchTaxNumber(lead, branchId) {
  const branch = getBranchById(lead, branchId);
  if (branch?.taxNumber) {
    return branch.taxNumber;
  }

  if (branchId === HQ_BRANCH_ID || !branchId) {
    return String(lead?.taxNumber || "").trim();
  }

  return "";
}

export function formatBranchOptionLabel(branch) {
  if (!branch) {
    return "Unknown branch";
  }

  const country = String(branch.country || "").trim();
  return country ? `${branch.label} (${country})` : branch.label;
}

export function getBranchById(lead, branchId) {
  return getLeadBranches(lead).find((branch) => branch.id === branchId) || null;
}

export function formatBranchLabel(lead, branchId) {
  const branch = getBranchById(lead, branchId);
  return branch ? formatBranchOptionLabel(branch) : "Unknown branch";
}

export function leadHasMultipleBranches(lead) {
  return getLeadBranches(lead).length > 1;
}

export function getLeadLocationSummary(lead) {
  const count = getLeadBranches(lead).length;
  if (count <= 1) {
    return { count: 1, label: "Single location", shortLabel: "1 location" };
  }
  return {
    count,
    label: `${count} locations`,
    shortLabel: `${count} locations`,
  };
}

export async function saveProductDraft(leadId, draft) {
  return updateLead(leadId, { productDraft: draft });
}

export async function clearProductDraft(leadId) {
  return updateLead(leadId, { productDraft: null });
}
