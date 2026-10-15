import { getAuthToken } from "./auth.js";
import { getCustomerToken } from "./customerAuth.js";
import { fetchJson } from "./http.js";

function authHeaders() {
  const token = getAuthToken();
  return token ? { Authorization: `Bearer ${token}` } : {};
}

export async function getCustomers({ scope } = {}) {
  const query = scope ? `?scope=${encodeURIComponent(scope)}` : "";
  const data = await fetchJson(`/api/customers${query}`, { headers: authHeaders() });
  return data.customers || [];
}

export async function getCustomerPortfolio({ scope } = {}) {
  const query = scope ? `?scope=${encodeURIComponent(scope)}` : "";
  const data = await fetchJson(`/api/customers/portfolio${query}`, { headers: authHeaders() });
  return data.portfolio || null;
}

export async function getOrganizationById(organizationId) {
  const data = await fetchJson(`/api/v1/organizations/${organizationId}`, {
    headers: authHeaders(),
  });
  return data.organization || null;
}

export async function getOrganizationSubscriptions(organizationId) {
  const data = await fetchJson(`/api/v1/organizations/${organizationId}/subscriptions`, {
    headers: authHeaders(),
  });
  return data.subscriptions || [];
}

export async function getSubscriptionEntitlements(subscriptionId) {
  const data = await fetchJson(`/api/v1/subscriptions/${subscriptionId}/entitlements`, {
    headers: authHeaders(),
  });
  return data.entitlements || null;
}

export async function getSubscriptionUsage(subscriptionId) {
  const data = await fetchJson(`/api/v1/subscriptions/${subscriptionId}/usage`, {
    headers: authHeaders(),
  });
  return data.usage || [];
}

export async function reportSubscriptionUsage(subscriptionId, metricKey, consumed) {
  const data = await fetchJson(`/api/v1/subscriptions/${subscriptionId}/usage`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...authHeaders() },
    body: JSON.stringify({ metricKey, consumed }),
  });
  return data.metric || null;
}

export async function loginCustomerUser(email, password) {
  const data = await fetchJson("/api/v1/customer/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  return data;
}

export async function getMyCustomerEntitlements() {
  const customerToken = getCustomerToken();
  const data = await fetchJson("/api/v1/me/entitlements", {
    headers: customerToken ? { Authorization: `Bearer ${customerToken}` } : {},
  });
  return data.entitlements || null;
}
