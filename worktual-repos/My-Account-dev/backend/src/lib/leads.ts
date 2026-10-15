/**
 * Server-side lead domain helpers (pure).
 * Client API wrappers live in frontend/src/lib/leads.js.
 */

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

export function formatLeadValue(lead: any, key: any) {
  return lead[key] ?? "";
}

export function leadSearchText(lead: any) {
  const extraAddresses = (lead.additionalAddresses || [])
    .map((entry: any) => `${entry.label} ${entry.address}`)
    .join(" ");

  return [
    lead.companyName,
    lead.contactName,
    lead.tenantId,
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

function formatBranchMobile(countryCode: any, mobileNumber: any) {
  const number = String(mobileNumber || "").trim();
  if (!number) {
    return "";
  }
  return `${countryCode || ""} ${number}`.trim();
}

export function formatLeadAddresses(lead: any) {
  return getLeadBranches(lead).map((branch: any) => ({
    id: branch.id,
    label: branch.label,
    address: branch.address,
    country: branch.country || "",
    taxNumber: branch.taxNumber || "",
    status: branch.status || "active",
    scheduledDropAt: branch.scheduledDropAt || null,
    isPrimary: branch.isPrimary === true,
    contactName: branch.contactName || "",
    designation: branch.designation || "",
    workEmail: branch.workEmail || "",
    mobile: branch.mobile || "",
    secondaryMobile: branch.secondaryMobile || "",
    industryType: branch.industryType || "",
  }));
}

export function formatLeadCreatedDate(value: any) {
  return new Date(value).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

/** True when a branch is still usable (not dropped/inactive). */
export function isLeadBranchActive(branch: any) {
  return (branch?.status || "active") !== "inactive";
}

/** Normalized branch list: HQ (billing address) plus additional branch locations.
 * Inactive (dropped) organization locations are omitted.
 */
export function getLeadBranches(lead: any, { includeInactive = false }: any = {}) {
  if (!lead) {
    return [];
  }

  const leadCountry = String(lead.country || "").trim();
  const branches: any[] = [];
  const locationMetaById = new Map(
    (lead.organizationLocations || []).map((entry: any) => [
      String(entry.id),
      {
        status: entry.status || "active",
        scheduledDropAt: entry.scheduledDropAt || null,
        contactName: entry.contactName || "",
        designation: entry.designation || "",
        workEmail: entry.workEmail || "",
        industryType: entry.industryType || "",
        mobileCountryCode: entry.mobileCountryCode || "",
        mobileNumber: entry.mobileNumber || "",
        secondaryMobileCountryCode: entry.secondaryMobileCountryCode || "",
        secondaryMobileNumber: entry.secondaryMobileNumber || "",
      },
    ]),
  );

  if (String(lead.billingAddress || "").trim()) {
    const hqMeta = locationMetaById.get(HQ_BRANCH_ID) as any;
    branches.push({
      id: HQ_BRANCH_ID,
      label: "Head office",
      address: lead.billingAddress.trim(),
      country: leadCountry,
      taxNumber: String(lead.taxNumber || "").trim(),
      isPrimary: true,
      status: hqMeta?.status || "active",
      scheduledDropAt: hqMeta?.scheduledDropAt || null,
      contactName: String(lead.contactName || "").trim(),
      designation: String(lead.designation || "").trim(),
      workEmail: String(lead.workEmail || "").trim(),
      mobile: formatBranchMobile(
        lead.mobileCountryCode || hqMeta?.mobileCountryCode,
        lead.mobileNumber || hqMeta?.mobileNumber,
      ),
      secondaryMobile: formatBranchMobile(
        lead.secondaryMobileCountryCode || hqMeta?.secondaryMobileCountryCode,
        lead.secondaryMobileNumber || hqMeta?.secondaryMobileNumber,
      ),
      industryType: String(lead.industryType || hqMeta?.industryType || "").trim(),
    });
  }

  for (const entry of lead.additionalAddresses || []) {
    if (!String(entry?.address || "").trim()) {
      continue;
    }

    const meta = locationMetaById.get(String(entry.id));

    branches.push({
      id: entry.id,
      label: String(entry.label || "").trim() || "Branch",
      address: String(entry.address || "").trim(),
      country: String(entry.country || "").trim() || leadCountry,
      taxNumber: String(entry.taxNumber || "").trim(),
      isPrimary: false,
      status: entry.status || (meta as any)?.status || "active",
      scheduledDropAt: entry.scheduledDropAt || (meta as any)?.scheduledDropAt || null,
      contactName: String(entry.contactName || (meta as any)?.contactName || "").trim(),
      designation: String(entry.designation || (meta as any)?.designation || "").trim(),
      workEmail: String(entry.workEmail || (meta as any)?.workEmail || "").trim(),
      mobile: formatBranchMobile(
        entry.mobileCountryCode || (meta as any)?.mobileCountryCode,
        entry.mobileNumber || (meta as any)?.mobileNumber,
      ),
      secondaryMobile: formatBranchMobile(
        entry.secondaryMobileCountryCode || (meta as any)?.secondaryMobileCountryCode,
        entry.secondaryMobileNumber || (meta as any)?.secondaryMobileNumber,
      ),
      industryType: String(entry.industryType || (meta as any)?.industryType || "").trim(),
    });
  }

  if (includeInactive) {
    return branches;
  }

  return branches.filter(isLeadBranchActive);
}

/** Inactive branch ids from organization location status. */
export function getInactiveLeadBranchIds(lead: any) {
  const ids = new Set();
  for (const entry of lead?.organizationLocations || []) {
    if ((entry.status || "active") === "inactive" && entry.id) {
      ids.add(String(entry.id));
    }
  }
  for (const entry of lead?.additionalAddresses || []) {
    if ((entry.status || "active") === "inactive" && entry.id) {
      ids.add(String(entry.id));
    }
  }
  return ids;
}

/** Country for pricing/tax — HQ uses lead country; branches may differ. */
export function getBranchCountry(lead: any, branchId: any) {
  const branch = getBranchById(lead, branchId);
  if (branch?.country) {
    return branch.country;
  }

  return String(lead?.country || "").trim();
}

/** GST/VAT/tax ID for invoicing — HQ uses lead tax number; branches may differ. */
export function getBranchTaxNumber(lead: any, branchId: any) {
  const branch = getBranchById(lead, branchId);
  if (branch?.taxNumber) {
    return branch.taxNumber;
  }

  if (branchId === HQ_BRANCH_ID || !branchId) {
    return String(lead?.taxNumber || "").trim();
  }

  return "";
}

export function formatBranchOptionLabel(branch: any) {
  if (!branch) {
    return "Unknown branch";
  }

  const country = String(branch.country || "").trim();
  return country ? `${branch.label} (${country})` : branch.label;
}

export function getBranchById(lead: any, branchId: any) {
  return getLeadBranches(lead).find((branch: any) => branch.id === branchId) || null;
}

export function formatBranchLabel(lead: any, branchId: any) {
  const branch = getBranchById(lead, branchId);
  return branch ? formatBranchOptionLabel(branch) : "Unknown branch";
}

export function leadHasMultipleBranches(lead: any) {
  return getLeadBranches(lead).length > 1;
}

export function getLeadLocationSummary(lead: any) {
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
