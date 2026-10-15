import { fetchJson } from "../http.js";

const BASE = "/api/v1/me/setup";
const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function assertEmailConfigId(id) {
  if (!id || !UUID_RE.test(String(id))) {
    throw new Error("Email configuration id is invalid.");
  }
}

async function setupFetch(path, options = {}) {
  const isFormData =
    typeof FormData !== "undefined" && options.body instanceof FormData;
  return fetchJson(`${BASE}${path}`, {
    ...options,
    headers: {
      ...(isFormData ? {} : { "Content-Type": "application/json" }),
      ...(options.headers || {}),
    },
  });
}

export async function getBusinessProfile() {
  const data = await setupFetch("/business-profile");
  return data.profile;
}

export async function saveBusinessProfile(payload) {
  const data = await setupFetch("/business-profile", {
    method: "PUT",
    body: JSON.stringify(payload),
  });
  return data.profile;
}

export async function listBranches() {
  const data = await setupFetch("/branches");
  return data.branches || [];
}

export async function createBranch(payload) {
  const data = await setupFetch("/branches", {
    method: "POST",
    body: JSON.stringify(payload),
  });
  return data.branch;
}

export async function updateBranch(id, payload) {
  const data = await setupFetch(`/branches/${encodeURIComponent(id)}`, {
    method: "PATCH",
    body: JSON.stringify(payload),
  });
  return data.branch;
}

export async function deleteBranch(id) {
  await setupFetch(`/branches/${encodeURIComponent(id)}`, { method: "DELETE" });
}

export async function listHolidayCalendars() {
  const data = await setupFetch("/holiday-calendars");
  return data.calendars || [];
}

export async function createHolidayCalendar(payload) {
  const data = await setupFetch("/holiday-calendars", {
    method: "POST",
    body: JSON.stringify(payload),
  });
  return data.calendar;
}

export async function addHolidays(calendarId, holidays) {
  const data = await setupFetch(`/holiday-calendars/${encodeURIComponent(calendarId)}/holidays`, {
    method: "POST",
    body: JSON.stringify({ holidays }),
  });
  return data.holidays || [];
}

export async function listBusinessHours() {
  const data = await setupFetch("/business-hours");
  return data.businessHours || [];
}

export async function createBusinessHours(payload) {
  const data = await setupFetch("/business-hours", {
    method: "POST",
    body: JSON.stringify(payload),
  });
  return data.businessHours;
}

export async function updateBusinessHours(id, payload) {
  const data = await setupFetch(`/business-hours/${encodeURIComponent(id)}`, {
    method: "PATCH",
    body: JSON.stringify(payload),
  });
  return data.businessHours;
}

export async function deleteBusinessHours(id) {
  await setupFetch(`/business-hours/${encodeURIComponent(id)}`, { method: "DELETE" });
}

export async function listTeams() {
  const data = await setupFetch("/teams");
  return data.teams || [];
}

export async function listQueues() {
  const data = await setupFetch("/ccaas/queues");
  return data.queues || [];
}

export async function getQueue(id) {
  const data = await setupFetch(`/ccaas/queues/${encodeURIComponent(id)}`);
  return data.queue;
}

export async function createQueue(payload) {
  const data = await setupFetch("/ccaas/queues", {
    method: "POST",
    body: JSON.stringify(payload),
  });
  return data.queue;
}

export async function updateQueue(id, payload) {
  const data = await setupFetch(`/ccaas/queues/${encodeURIComponent(id)}`, {
    method: "PATCH",
    body: JSON.stringify(payload),
  });
  return data.queue;
}

export async function deleteQueue(id) {
  await setupFetch(`/ccaas/queues/${encodeURIComponent(id)}`, { method: "DELETE" });
}

export async function replaceQueueAgents(id, agents) {
  const data = await setupFetch(`/ccaas/queues/${encodeURIComponent(id)}/agents`, {
    method: "PUT",
    body: JSON.stringify({ agents }),
  });
  return data.queue;
}

export async function listCcaasEligibleAgents() {
  const data = await setupFetch("/ccaas/eligible-agents");
  return data.users || [];
}

export async function getTeam(id) {
  const data = await setupFetch(`/teams/${encodeURIComponent(id)}`);
  return data.team;
}

export async function createTeam(payload) {
  const data = await setupFetch("/teams", {
    method: "POST",
    body: JSON.stringify(payload),
  });
  return data.team;
}

export async function updateTeam(id, payload) {
  const data = await setupFetch(`/teams/${encodeURIComponent(id)}`, {
    method: "PATCH",
    body: JSON.stringify(payload),
  });
  return data.team;
}

export async function deleteTeam(id) {
  await setupFetch(`/teams/${encodeURIComponent(id)}`, { method: "DELETE" });
}

export async function listRoles() {
  const data = await setupFetch("/roles");
  return data.roles || [];
}

export async function createRole(payload) {
  const data = await setupFetch("/roles", {
    method: "POST",
    body: JSON.stringify(payload),
  });
  return data.role;
}

export async function updateRole(id, payload) {
  const data = await setupFetch(`/roles/${encodeURIComponent(id)}`, {
    method: "PATCH",
    body: JSON.stringify(payload),
  });
  return data.role;
}

export async function deleteRole(id) {
  await setupFetch(`/roles/${encodeURIComponent(id)}`, { method: "DELETE" });
}

export async function listSetupUsers() {
  const data = await setupFetch("/users");
  return data.users || [];
}

export async function createSetupUser(payload) {
  const data = await setupFetch("/users", {
    method: "POST",
    body: JSON.stringify(payload),
  });
  return data;
}

export async function updateSetupUser(id, payload) {
  const data = await setupFetch(`/users/${encodeURIComponent(id)}`, {
    method: "PATCH",
    body: JSON.stringify(payload),
  });
  return data;
}

export async function deleteSetupUser(id) {
  await setupFetch(`/users/${encodeURIComponent(id)}`, { method: "DELETE" });
}

export async function resendSetupUserInvite(id) {
  const data = await setupFetch(`/users/${encodeURIComponent(id)}/resend-invite`, {
    method: "POST",
  });
  return data;
}

export async function listChannelConfigs(type) {
  const query = type ? `?type=${encodeURIComponent(type)}` : "";
  const data = await setupFetch(`/channels${query}`);
  return data.channels || [];
}

export async function getEmailChannelConfig(id) {
  assertEmailConfigId(id);
  const data = await setupFetch(`/channels/email/${encodeURIComponent(id)}`);
  return data.config;
}

export async function createEmailChannelConfig(payload) {
  const data = await setupFetch("/channels/email", {
    method: "POST",
    body: JSON.stringify(payload),
  });
  if (!data?.config?.id) {
    throw new Error("Server did not return a configuration id.");
  }
  return data.config;
}

export async function updateEmailChannelConfig(id, payload) {
  assertEmailConfigId(id);
  const data = await setupFetch(`/channels/email/${encodeURIComponent(id)}`, {
    method: "PATCH",
    body: JSON.stringify(payload),
  });
  return data.config;
}

export async function deleteEmailChannelConfig(id) {
  assertEmailConfigId(id);
  await setupFetch(`/channels/email/${encodeURIComponent(id)}`, { method: "DELETE" });
}

export async function verifyEmailChannelConfig(id) {
  assertEmailConfigId(id);
  const data = await setupFetch(`/channels/email/${encodeURIComponent(id)}/verify`, {
    method: "POST",
  });
  return data.result;
}

export async function confirmEmailDomain(id) {
  assertEmailConfigId(id);
  const data = await setupFetch(`/channels/email/${encodeURIComponent(id)}/confirm-domain`, {
    method: "POST",
  });
  return data.result;
}

export function emailOAuthConnectUrl(id, { redirect = true, provider } = {}) {
  assertEmailConfigId(id);
  const params = new URLSearchParams();
  if (redirect) params.set("redirect", "true");
  if (provider) params.set("provider", provider);
  return `${BASE}/channels/email/${encodeURIComponent(id)}/oauth/connect?${params.toString()}`;
}

/** Authenticated fetch of the provider authorize URL (do not use window.location on the API path). */
export async function startEmailOAuthConnect(id, { provider } = {}) {
  assertEmailConfigId(id);
  const params = new URLSearchParams();
  if (provider) params.set("provider", provider);
  const query = params.toString() ? `?${params.toString()}` : "";
  return setupFetch(`/channels/email/${encodeURIComponent(id)}/oauth/connect${query}`);
}

export async function getWebchatChannelConfig(id) {
  assertEmailConfigId(id);
  const data = await setupFetch(`/channels/web-chat/${encodeURIComponent(id)}`);
  return data.config;
}

export async function createWebchatChannelConfig(payload) {
  const data = await setupFetch("/channels/web-chat", {
    method: "POST",
    body: JSON.stringify(payload),
  });
  if (!data?.config?.id) {
    throw new Error("Server did not return a configuration id.");
  }
  return data.config;
}

export async function updateWebchatChannelConfig(id, payload) {
  assertEmailConfigId(id);
  const data = await setupFetch(`/channels/web-chat/${encodeURIComponent(id)}`, {
    method: "PATCH",
    body: JSON.stringify(payload),
  });
  return data.config;
}

export async function deleteWebchatChannelConfig(id) {
  assertEmailConfigId(id);
  await setupFetch(`/channels/web-chat/${encodeURIComponent(id)}`, { method: "DELETE" });
}

export async function uploadWebchatAsset(id, kind, file) {
  assertEmailConfigId(id);
  const formData = new FormData();
  formData.append("file", file);
  formData.append("kind", kind);
  const data = await setupFetch(`/channels/web-chat/${encodeURIComponent(id)}/assets`, {
    method: "POST",
    body: formData,
  });
  return data;
}

export async function listKnowledgeDocuments(category) {
  const query = category ? `?category=${encodeURIComponent(category)}` : "";
  const data = await setupFetch(`/knowledge-documents${query}`);
  return data.documents || [];
}

export async function uploadKnowledgeDocument({
  file,
  category,
  allBranches,
  assignedBranchIds = [],
}) {
  const formData = new FormData();
  formData.append("file", file);
  formData.append("category", category);
  formData.append("allBranches", allBranches ? "true" : "false");
  formData.append("assignedBranchIds", JSON.stringify(assignedBranchIds));

  const data = await fetchJson(`${BASE}/knowledge-documents`, {
    method: "POST",
    body: formData,
  });
  return data.document;
}

export async function deleteKnowledgeDocument(id) {
  await setupFetch(`/knowledge-documents/${encodeURIComponent(id)}`, { method: "DELETE" });
}

export const KNOWLEDGE_CATEGORY_TABS = [
  { id: "business", label: "Business Knowledge" },
  { id: "product", label: "Product Knowledge" },
  { id: "customer_support", label: "Customer Support Knowledge" },
];

export const SETUP_TIMEZONES = [
  "Asia/Kolkata",
  "UTC",
  "Europe/London",
  "America/New_York",
  "Asia/Dubai",
  "Asia/Singapore",
];

export const SETUP_DAYS = [
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
  "Sunday",
];

export { SETUP_SHIFT_TYPES, SETUP_HOLIDAY_COUNTRIES, holidaysForCountry } from "./countryHolidays.js";
