import { buildLeadDashboardModel } from "./leadDashboard.js";
import { getMyCustomerEntitlements } from "./organizations.js";
import { fetchJson } from "./http.js";

export function organizationToLeadShape(organization, subscriptions = []) {
  if (!organization) {
    return null;
  }

  const locations = organization.locations || [];
  const primaryLocation = locations.find((entry) => entry.isPrimary) || locations[0];
  const additionalAddresses = locations
    .filter((entry) => !entry.isPrimary)
    .map((entry) => ({
      id: entry.id,
      label: entry.label || "Branch",
      address: entry.address || "",
      country: entry.country || "",
      taxNumber: entry.taxNumber || "",
      status: entry.status || "active",
      scheduledDropAt: entry.scheduledDropAt || null,
    }));

  return {
    id: organization.sourceLeadId || organization.id,
    status: "Paid",
    companyName: organization.companyName || "",
    contactName: organization.contactName || "",
    designation: organization.designation || "",
    workEmail: organization.workEmail || "",
    adminEmail: organization.adminEmail || "",
    taxNumber: organization.taxNumber || "",
    billingAddress: organization.billingAddress || primaryLocation?.address || "",
    additionalAddresses,
    organizationLocations: locations,
    websiteUrl: organization.websiteUrl || "",
    country: organization.country || "",
    companySize: organization.companySize || "",
    mobileCountryCode: organization.mobileCountryCode || "+91",
    mobileNumber: organization.mobileNumber || "",
    industryType: organization.industryType || "",
    domainId: organization.domainId || "",
    convertedAt: organization.convertedAt,
    createdAt: organization.createdAt,
    subscriptions,
    organizationLocations: locations,
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
  const dashboard = buildLeadDashboardModel(lead, usageBySubscriptionId);

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
