import { fetchJson } from "./http.js";

export async function fetchNumberManagementDashboard() {
  return fetchJson("/api/number-management/dashboard");
}

export async function fetchNumberManagementCustomer(organizationId) {
  return fetchJson(`/api/number-management/customers/${encodeURIComponent(organizationId)}`);
}

export async function fetchNumberManagementCustomerUsage(organizationId, yearMonth) {
  const query = yearMonth ? `?yearMonth=${encodeURIComponent(yearMonth)}` : "";
  return fetchJson(
    `/api/number-management/customers/${encodeURIComponent(organizationId)}/usage${query}`,
  );
}

export async function fetchNumberMappings(params = {}) {
  const search = new URLSearchParams();
  if (params.search) search.set("search", params.search);
  if (params.tenantId) search.set("tenantId", params.tenantId);
  if (params.status) search.set("status", params.status);
  const suffix = search.toString() ? `?${search}` : "";
  return fetchJson(`/api/number-management/mappings${suffix}`);
}

export async function fetchTenantMappingCapacity(tenantId, excludeMappingId) {
  const search = new URLSearchParams();
  if (tenantId) search.set("tenantId", tenantId);
  if (excludeMappingId) search.set("excludeMappingId", excludeMappingId);
  return fetchJson(`/api/number-management/mapping-capacity?${search}`);
}

export async function fetchAvailableNumbers(params = {}) {
  const search = new URLSearchParams();
  if (params.search) search.set("search", params.search);
  const suffix = search.toString() ? `?${search}` : "";
  return fetchJson(`/api/number-management/available-numbers${suffix}`);
}

export async function createAvailableNumber(payload) {
  return fetchJson("/api/number-management/available-numbers", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
}

export async function deleteAvailableNumber(id) {
  return fetchJson(`/api/number-management/available-numbers/${encodeURIComponent(id)}`, {
    method: "DELETE",
  });
}

export async function fetchNumberProviders(params = {}) {
  const search = new URLSearchParams();
  if (params.search) search.set("search", params.search);
  const suffix = search.toString() ? `?${search}` : "";
  return fetchJson(`/api/number-management/providers${suffix}`);
}

export async function createNumberProvider(payload) {
  return fetchJson("/api/number-management/providers", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
}

export async function updateNumberProvider(id, payload) {
  return fetchJson(`/api/number-management/providers/${encodeURIComponent(id)}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
}

export async function deleteNumberProvider(id) {
  return fetchJson(`/api/number-management/providers/${encodeURIComponent(id)}`, {
    method: "DELETE",
  });
}

export async function fetchProviderNumbers(providerId, params = {}) {
  const search = new URLSearchParams();
  if (params.search) search.set("search", params.search);
  const suffix = search.toString() ? `?${search}` : "";
  return fetchJson(
    `/api/number-management/providers/${encodeURIComponent(providerId)}/numbers${suffix}`,
  );
}

export async function createProviderNumber(providerId, payload) {
  return fetchJson(`/api/number-management/providers/${encodeURIComponent(providerId)}/numbers`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
}

export async function deleteProviderNumber(providerId, numberId) {
  return fetchJson(
    `/api/number-management/providers/${encodeURIComponent(providerId)}/numbers/${encodeURIComponent(numberId)}`,
    { method: "DELETE" },
  );
}

export async function previewProviderNumberImport(providerId, numbers) {
  return fetchJson(
    `/api/number-management/providers/${encodeURIComponent(providerId)}/numbers/import-preview`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ numbers }),
    },
  );
}

export async function confirmProviderNumberImport(providerId, numbers, skip = []) {
  return fetchJson(
    `/api/number-management/providers/${encodeURIComponent(providerId)}/numbers/import`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ numbers, skip }),
    },
  );
}

export async function createNumberMapping(payload) {
  return fetchJson("/api/number-management/mappings", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
}

export async function updateNumberMapping(id, payload) {
  return fetchJson(`/api/number-management/mappings/${encodeURIComponent(id)}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
}

export async function deleteNumberMapping(id) {
  return fetchJson(`/api/number-management/mappings/${encodeURIComponent(id)}`, {
    method: "DELETE",
  });
}

export async function fetchMailTemplates() {
  return fetchJson("/api/mail/templates");
}

export async function createMailTemplate(payload) {
  return fetchJson("/api/mail/templates", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
}

export async function updateMailTemplate(id, payload) {
  return fetchJson(`/api/mail/templates/${encodeURIComponent(id)}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
}

export async function deleteMailTemplate(id) {
  return fetchJson(`/api/mail/templates/${encodeURIComponent(id)}`, {
    method: "DELETE",
  });
}
