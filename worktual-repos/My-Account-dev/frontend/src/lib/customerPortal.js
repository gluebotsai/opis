import { buildLeadDashboardModel } from "./leadDashboard.js";
import { getBranchById, HQ_BRANCH_ID } from "./leads.js";
import { getMyCustomerEntitlements } from "./organizations.js";
import { fetchJson } from "./http.js";

const UUID_LIKE_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const HQ_LABEL_ALIASES = new Set([
  "hq",
  "head office",
  "headoffice",
  "head-office",
  "primary",
]);

function mapOrganizationLocationToAddress(entry) {
  return {
    id: entry.id,
    label: entry.label || "Branch",
    address: entry.address || "",
    country: entry.country || "",
    taxNumber: entry.taxNumber || "",
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
  };
}

function isRawBranchIdentifier(value) {
  const text = String(value || "").trim();
  if (!text) {
    return true;
  }
  if (UUID_LIKE_RE.test(text)) {
    return true;
  }
  // Opaque non-word ids (legacy random tokens) — not human location names.
  if (/^[0-9a-f]{16,}$/i.test(text) && !/\s/.test(text)) {
    return true;
  }
  return false;
}

function asHqDisplayLabel(value) {
  const text = String(value || "").trim();
  if (!text) {
    return null;
  }
  if (HQ_LABEL_ALIASES.has(text.toLowerCase())) {
    return "HQ";
  }
  return null;
}

/**
 * Customer portal location chip for product rows (`Product · Location`).
 * - HQ / primary / legacy `"hq"` → `"HQ"`
 * - Named branch from org/lead addresses → human label
 * - UUID / missing friendly label → `"Branch"`
 */
export function formatCustomerPortalBranchLabel(lead, branchId, fallbackLabel = "") {
  const id = String(branchId || "").trim();
  const provided = String(fallbackLabel || "").trim();

  if (!id || id.toLowerCase() === HQ_BRANCH_ID) {
    return "HQ";
  }

  const providedHq = asHqDisplayLabel(provided);
  if (providedHq) {
    return providedHq;
  }
  if (provided && !isRawBranchIdentifier(provided)) {
    return provided;
  }

  const locations = lead?.organizationLocations || [];
  const orgMatch = locations.find((entry) => String(entry?.id || "") === id);
  if (orgMatch) {
    if (orgMatch.isPrimary === true) {
      return "HQ";
    }
    const orgLabel = String(orgMatch.label || "").trim();
    const orgHq = asHqDisplayLabel(orgLabel);
    if (orgHq) {
      return orgHq;
    }
    if (orgLabel && !isRawBranchIdentifier(orgLabel)) {
      return orgLabel;
    }
    return "Branch";
  }

  const branch = getBranchById(lead, id);
  if (branch) {
    if (branch.isPrimary === true || String(branch.id) === HQ_BRANCH_ID) {
      return "HQ";
    }
    const branchLabel = String(branch.label || "").trim();
    const branchHq = asHqDisplayLabel(branchLabel);
    if (branchHq) {
      return branchHq;
    }
    if (branchLabel && !isRawBranchIdentifier(branchLabel)) {
      return branchLabel;
    }
    return "Branch";
  }

  return "Branch";
}

function withPortalBranchLabels(dashboard, lead) {
  if (!dashboard?.activeProducts?.length) {
    return dashboard;
  }

  return {
    ...dashboard,
    activeProducts: dashboard.activeProducts.map((entry) => ({
      ...entry,
      branchLabel: formatCustomerPortalBranchLabel(lead, entry.branchId, entry.branchLabel),
      billingLabel: formatCustomerPortalBranchLabel(
        lead,
        entry.billingBranchId || entry.branchId,
        entry.billingLabel,
      ),
    })),
  };
}

export function organizationToLeadShape(organization, subscriptions = []) {
  if (!organization) {
    return null;
  }

  const locations = organization.locations || [];
  const primaryLocation = locations.find((entry) => entry.isPrimary) || null;
  // Non-head entitlements omit the primary location. Do not synthesize HQ from billingAddress.
  const branchScopedOnly = !primaryLocation && locations.length > 0;
  const additionalAddresses = (
    branchScopedOnly ? locations : locations.filter((entry) => !entry.isPrimary)
  ).map(mapOrganizationLocationToAddress);

  return {
    id: organization.sourceLeadId || organization.id,
    status: "Paid",
    companyName: organization.companyName || "",
    contactName: organization.contactName || "",
    designation: organization.designation || "",
    workEmail: organization.workEmail || "",
    adminEmail: organization.adminEmail || "",
    taxNumber: organization.taxNumber || "",
    billingAddress: branchScopedOnly
      ? ""
      : organization.billingAddress || primaryLocation?.address || "",
    additionalAddresses,
    organizationLocations: locations,
    websiteUrl: organization.websiteUrl || "",
    country: organization.country || "",
    companySize: organization.companySize || "",
    mobileCountryCode: organization.mobileCountryCode || "+91",
    mobileNumber: organization.mobileNumber || "",
    secondaryMobileCountryCode: organization.secondaryMobileCountryCode || "",
    secondaryMobileNumber: organization.secondaryMobileNumber || "",
    industryType: organization.industryType || "",
    tenantId: organization.tenantId || "",
    convertedAt: organization.convertedAt,
    createdAt: organization.createdAt,
    subscriptions,
  };
}

export async function getCustomerSubscriptionUsage(subscriptionId) {
  const data = await fetchJson(`/api/v1/me/subscriptions/${subscriptionId}/usage`);
  return data.usage || [];
}

export async function loadUsageForSubscriptions(subscriptions = []) {
  if (!subscriptions.length) {
    return {};
  }

  const entries = await Promise.all(
    subscriptions.map(async (subscription) => {
      try {
        const usage = await getCustomerSubscriptionUsage(subscription.id);
        return [subscription.id, usage];
      } catch {
        return [subscription.id, []];
      }
    }),
  );

  return Object.fromEntries(entries);
}

export async function loadCustomerPortalData() {
  const entitlements = await getMyCustomerEntitlements();
  if (!entitlements) {
    return null;
  }

  const lead = organizationToLeadShape(
    entitlements.organization,
    entitlements.subscriptions || [],
  );
  const usageBySubscriptionId = await loadUsageForSubscriptions(entitlements.subscriptions || []);
  const dashboard = withPortalBranchLabels(
    buildLeadDashboardModel(lead, usageBySubscriptionId),
    lead,
  );

  return {
    entitlements,
    lead,
    dashboard,
    usageBySubscriptionId,
    portalUser: entitlements.user,
  };
}

export function buildCustomerProductPath(productKey) {
  return `/customer/products/${encodeURIComponent(productKey || "")}`;
}

export async function changeCustomerPassword(payload) {
  return fetchJson("/api/v1/me/password", {
    method: "PUT",
    body: JSON.stringify(payload),
  });
}

export async function deleteCustomerAccount({ password, confirmName }) {
  return fetchJson("/api/customer/account", {
    method: "DELETE",
    body: JSON.stringify({ password, confirmName }),
  });
}
