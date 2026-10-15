import { getChangeTypeLabel } from "./activeProducts.js";
import { getCcaasPlanLabel } from "./ccaasPlans.js";
import { getCcaasModule, getModuleOption, isModuleBillable } from "./ccaasModules.js";
import { fetchJson } from "./http.js";

export async function listMyProductRequests() {
  const data = await fetchJson("/api/v1/me/product-requests");
  return data.requests || [];
}

export async function listLeadProductRequests(leadId) {
  const data = await fetchJson(`/api/leads/${leadId}/product-requests`);
  return data.requests || [];
}

export async function listSalesOpenProductRequests({ scope } = {}) {
  const query = scope ? `?scope=${encodeURIComponent(scope)}` : "";
  const data = await fetchJson(`/api/customers/product-requests${query}`);
  return data.requests || [];
}

export async function materializeProductRequestBranches(leadId, requestId) {
  const data = await fetchJson(
    `/api/leads/${leadId}/product-requests/${requestId}/materialize-branches`,
    { method: "POST" },
  );
  return data;
}

export async function createCustomerProductRequest(payload) {
  const data = await fetchJson("/api/v1/me/product-requests", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  return data.request || null;
}

export async function updateMyProductRequest(requestId, payload) {
  const data = await fetchJson(`/api/v1/me/product-requests/${requestId}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  return data.request || null;
}

export async function notifyMyProductRequestAgain(requestId) {
  const data = await fetchJson(`/api/v1/me/product-requests/${requestId}/notify`, {
    method: "POST",
  });
  return data.request || null;
}

export async function cancelMyProductRequest(requestId) {
  const data = await fetchJson(`/api/v1/me/product-requests/${requestId}/cancel`, {
    method: "POST",
  });
  return data.request || null;
}

function assignmentProductBranchKey(entry) {
  const productId = String(entry?.productId || "").trim();
  const branchId = String(entry?.branchId || "hq").trim() || "hq";
  return productId ? `${productId}::${branchId}` : "";
}

/** Open enough that a duplicate create should be blocked. */
export function isBlockingOpenProductRequest(request) {
  const display = productRequestDisplayStatus(request);
  return (
    display === "open" ||
    display === "rejected" ||
    display === "awaiting_finance" ||
    display === "approved"
  );
}

export function canEditCustomerProductRequest(request) {
  if (String(request?.requestType || "").trim().toLowerCase() === "inquiry") {
    return false;
  }
  const display = productRequestDisplayStatus(request);
  return display === "open" || display === "rejected";
}

export function canNotifyCustomerProductRequestAgain(request) {
  return isBlockingOpenProductRequest(request);
}

/**
 * Find an open request that already includes this product (+ optional branch).
 */
export function findOpenInquiryProductRequest(requests) {
  for (const request of requests || []) {
    if (String(request?.requestType || "").trim().toLowerCase() !== "inquiry") {
      continue;
    }
    if (!isBlockingOpenProductRequest(request)) {
      continue;
    }
    return request;
  }
  return null;
}

export function findOpenProductRequestForProduct(requests, productId, branchId = null) {
  const pid = String(productId || "").trim();
  if (!pid) {
    return null;
  }
  const bid =
    branchId == null || String(branchId).trim() === "" ? null : String(branchId).trim();

  for (const request of requests || []) {
    if (!isBlockingOpenProductRequest(request)) {
      continue;
    }
    for (const entry of request.assignments || []) {
      if (String(entry.productId || "").trim() !== pid) {
        continue;
      }
      if (bid && String(entry.branchId || "hq").trim() !== bid) {
        continue;
      }
      return request;
    }
  }
  return null;
}

export function findOpenProductRequestConflict(requests, assignments, { ignoreRequestId = null } = {}) {
  const ignoreId = ignoreRequestId ? String(ignoreRequestId) : null;
  const requestedKeys = new Set(
    (assignments || []).map(assignmentProductBranchKey).filter(Boolean),
  );

  for (const request of requests || []) {
    if (ignoreId && String(request.id) === ignoreId) {
      continue;
    }
    if (!isBlockingOpenProductRequest(request)) {
      continue;
    }
    for (const entry of request.assignments || []) {
      const key = assignmentProductBranchKey(entry);
      if (!key || !requestedKeys.has(key)) {
        continue;
      }
      const [productId, branchId] = key.split("::");
      return { request, productId, branchId };
    }
  }
  return null;
}

export function deriveRequestType(assignments = []) {
  const changeTypes = new Set(assignments.map((entry) => entry.changeType || "new"));

  if (changeTypes.size === 1 && changeTypes.has("new")) {
    return "new";
  }

  if ([...changeTypes].every((type) => type === "upgrade" || type === "addon")) {
    return "upgrade";
  }

  return "mixed";
}

export function productRequestTypeLabel(requestType) {
  switch (requestType) {
    case "new":
      return "New product";
    case "upgrade":
      return "Upgrade / add-on";
    case "mixed":
      return "Mixed";
    case "inquiry":
      return "New product inquiry";
    default:
      return requestType || "Request";
  }
}

/** Primary line for sales list cards (inquiry has no configured products). */
export function productRequestListTitle(request) {
  if (String(request?.requestType || "").trim().toLowerCase() === "inquiry") {
    return "New product inquiry";
  }

  const productLines = (request?.productSummary || [])
    .map((entry) => String(entry?.name || "").trim())
    .filter(Boolean);

  if (productLines.length) {
    return productLines.join(", ");
  }

  return productRequestTypeLabel(request?.requestType) || "Product request";
}

/** Short list-card line for requests that include draft new locations. */
export function formatProductRequestNewBranchSummary(request) {
  const branches = Array.isArray(request?.newBranches) ? request.newBranches : [];
  if (!branches.length) {
    return "";
  }

  const labels = branches.map((entry) => {
    const label = String(entry?.label || "").trim();
    return label || "New location";
  });

  const prefix = labels.length === 1 ? "Includes new location" : "Includes new locations";
  return `${prefix}: ${labels.join(", ")}`;
}

function formatBranchMobile(countryCode, number) {
  const digits = String(number || "").trim();
  if (!digits) {
    return "";
  }
  const code = String(countryCode || "").trim();
  return code ? `${code} ${digits}` : digits;
}

/** Rows for the View-details “New locations” section. */
export function buildProductRequestNewBranchDetailRows(branch) {
  if (!branch) {
    return [];
  }

  const rows = [];
  const push = (label, value) => {
    const normalized = value == null ? "" : String(value).trim();
    if (!normalized) {
      return;
    }
    rows.push({ label, value: normalized });
  };

  push("Address", branch.address);
  const region = [branch.state, branch.country].filter(Boolean).join(", ");
  push("Region", region);
  push("Tax ID", branch.taxNumber);
  push("Contact", branch.contactName);
  push("Work email", branch.workEmail);
  push("Mobile", formatBranchMobile(branch.mobileCountryCode, branch.mobileNumber));

  return rows;
}

export function productRequestStatusLabel(status) {
  switch (status) {
    case "submitted":
    case "open":
      return "Open";
    case "awaiting_finance":
      return "Awaiting finance approval";
    case "approved":
      return "Approved";
    case "rejected":
      return "Rejected";
    case "cancelled":
      return "Withdrawn";
    case "fulfilled":
      return "Completed";
    default:
      return status || "Unknown";
  }
}

/** Customer portal badge/copy for product-request cards. */
export function customerProductRequestStatusLabel(request) {
  const display = productRequestDisplayStatus(request);
  const quoteStatus = String(request?.linkedQuotationStatus || "").trim();

  if (display === "fulfilled") {
    return "Completed";
  }
  if (display === "cancelled") {
    return "Withdrawn";
  }
  if (display === "rejected") {
    return "Rejected";
  }
  if (quoteStatus === "Paid") {
    return "Payment received";
  }
  if (display === "awaiting_finance" || display === "approved") {
    return "Quotation ready / awaiting payment";
  }
  return "Sent to sales";
}

export function customerProductRequestStatusHint(request) {
  const display = productRequestDisplayStatus(request);
  const quoteStatus = String(request?.linkedQuotationStatus || "").trim();
  const isInquiry = String(request?.requestType || "").trim().toLowerCase() === "inquiry";

  if (quoteStatus === "Paid") {
    return "Payment received. Your products will appear under Subscribed products shortly.";
  }
  if (display === "awaiting_finance" || display === "approved") {
    return "Your quotation is ready. Complete payment to activate the products.";
  }
  if (display === "rejected") {
    return "Sales rejected this request. You can submit a new request if needed.";
  }
  if (display === "open") {
    return isInquiry
      ? "Your inquiry was sent to the sales team. They will follow up about available products."
      : "Your request was sent to the sales team. They will follow up with a quotation.";
  }
  return "";
}

/** Badge tone for sales dashboard product-request pills. */
export function productRequestDisplayStatusTone(displayStatus) {
  switch (displayStatus) {
    case "awaiting_finance":
      return "in-progress";
    case "approved":
      return "qualified";
    case "rejected":
      return "inactive";
    case "fulfilled":
      return "qualified";
    case "cancelled":
      return "neutral";
    case "open":
    default:
      return "new";
  }
}

export function productRequestDisplayStatus(request) {
  if (request?.displayStatus) {
    return request.displayStatus;
  }
  return String(request?.status || "submitted") === "submitted" ? "open" : request?.status || "open";
}

/** Visible on sales Customer product requests until finance approves a linked quote (or withdrawn). */
export function isOpenSalesProductRequest(request) {
  const displayStatus = productRequestDisplayStatus(request);
  return (
    displayStatus === "open" ||
    displayStatus === "awaiting_finance" ||
    displayStatus === "rejected"
  );
}

export function canOpenProductRequestInWorkflow(request) {
  if (String(request?.requestType || "").trim().toLowerCase() === "inquiry") {
    // Inquiry has no assignments — sales starts a fresh quote from the lead.
    return productRequestDisplayStatus(request) === "open";
  }
  const displayStatus = productRequestDisplayStatus(request);
  return displayStatus === "open" || displayStatus === "rejected";
}

export function productRequestStatusHelperText(displayStatus) {
  if (displayStatus === "approved") {
    return "Awaiting customer payment";
  }
  if (displayStatus === "rejected") {
    return "Finance rejected — open in workflow to revise";
  }
  if (displayStatus === "awaiting_finance") {
    return "Sent for finance review";
  }
  return "";
}

function formatBillingCycle(value) {
  const cycle = String(value || "").trim().toLowerCase();
  if (cycle === "monthly") {
    return "Monthly";
  }
  if (cycle === "annual" || cycle === "yearly") {
    return "Annual";
  }
  return value ? String(value) : "";
}

function listSelectedModuleLabels(modulesConfig) {
  if (!modulesConfig || typeof modulesConfig !== "object") {
    return [];
  }

  const labels = [];
  for (const [moduleId, selection] of Object.entries(modulesConfig)) {
    if (!isModuleBillable(selection)) {
      continue;
    }
    const moduleLabel = getCcaasModule(moduleId)?.label || moduleId;
    const optionLabel = getModuleOption(moduleId, selection.optionId)?.label || selection.optionId;
    labels.push(optionLabel ? `${moduleLabel}: ${optionLabel}` : moduleLabel);
  }
  return labels;
}

function pushRow(rows, label, value, section = "") {
  const normalized = value == null ? "" : String(value).trim();
  if (!normalized) {
    return;
  }
  rows.push(section ? { section, label, value: normalized } : { label, value: normalized });
}

function positiveCount(value) {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? Math.trunc(n) : 0;
}

function summarizeCcaasConfig(config, rows) {
  const planLabel = getCcaasPlanLabel(config.licenseTier) || config.licenseTier;
  if (planLabel) {
    pushRow(rows, "Plan", planLabel, "Contact Center");
  }

  const agentCount = positiveCount(config.usageDetails?.agentCount);
  if (agentCount) {
    pushRow(rows, "Agents", String(agentCount), "Contact Center");
  }

  const modules = listSelectedModuleLabels(config.modules);
  if (modules.length) {
    pushRow(rows, "Modules", modules.join("; "), "Contact Center");
  }

  const addons = config.addons || {};
  if (addons.sessionBundle && addons.sessionBundle !== "none") {
    const sessionsLabel =
      addons.sessionBundle === "custom"
        ? `${positiveCount(addons.customSessionCount) || "Custom"} sessions`
        : `${Number(addons.sessionBundle).toLocaleString("en-IN")} sessions`;
    pushRow(rows, "Session pack", sessionsLabel, "Add-ons");
  } else if (addons.sessionsEnabled) {
    pushRow(rows, "Session pack", "Enabled", "Add-ons");
  }

  if (addons.multilingualOption === "addon" || addons.multilingualEnabled) {
    pushRow(rows, "Multilingual", "Enabled", "Add-ons");
  }
}

function summarizeCrmConfig(config, rows) {
  const users = positiveCount(config.userCount);
  if (users) {
    pushRow(rows, "CRM users", String(users), "CRM License");
  }

  const includedContacts = positiveCount(config.includedContacts || config.contactCount);
  if (includedContacts) {
    pushRow(rows, "Included contacts", String(includedContacts.toLocaleString("en-IN")), "CRM License");
  }

  if (config.additionalUsersEnabled && positiveCount(config.additionalUserCount)) {
    pushRow(
      rows,
      "Additional users",
      `+${positiveCount(config.additionalUserCount)}`,
      "Add-ons",
    );
  }

  if (config.additionalContactsEnabled && config.additionalContactSlab) {
    pushRow(rows, "Additional contacts slab", String(config.additionalContactSlab), "Add-ons");
  }
}

function summarizeCampaignConfig(config, rows) {
  const midPeriodOnly = Boolean(config.midPeriodAddons?.active);
  const baseOn =
    config.basePlanEnabled === true ||
    (config.basePlanEnabled === undefined &&
      Boolean(config.monthlyBasePrice || config.includedContacts || config.campaignContacts));

  if (!midPeriodOnly && baseOn) {
    const included = positiveCount(config.includedContacts || config.campaignContacts);
    if (included) {
      pushRow(rows, "Included contacts", String(included.toLocaleString("en-IN")), "Campaign Plan");
    } else {
      pushRow(rows, "Base plan", "Included", "Campaign Plan");
    }
  } else if (midPeriodOnly) {
    pushRow(rows, "Request type", "Mid-period channel packs", "Add-ons");
  }

  const channels = [
    ["Web push subscribers", config.webPushSubscribers],
    ["App push subscribers", config.appPushSubscribers],
    ["Email", config.emailCount],
    ["SMS", config.smsCount],
    ["WhatsApp credits", config.whatsappCredits],
  ];

  for (const [label, count] of channels) {
    const value = positiveCount(count);
    if (value) {
      pushRow(rows, label, String(value.toLocaleString("en-IN")), "Channel packs");
    }
  }

  if (config.additionalContactsEnabled && config.additionalContactSlab) {
    pushRow(rows, "Additional contacts slab", String(config.additionalContactSlab), "Add-ons");
  }
}

function summarizeCdpConfig(config, rows) {
  const profiles = positiveCount(config.customerProfiles);
  if (profiles) {
    pushRow(rows, "Customer profiles", String(profiles.toLocaleString("en-IN")), "CDP Platform");
  } else if (config.platformEnabled !== false) {
    pushRow(rows, "Platform", "Enabled", "CDP Platform");
  }

  if (config.additionalContactsEnabled && config.additionalContactSlab) {
    pushRow(rows, "Additional contacts slab", String(config.additionalContactSlab), "Add-ons");
  }
}

function summarizeValueManagementConfig(config, rows) {
  const mau = positiveCount(config.monthlyActiveUsers);
  if (mau) {
    pushRow(
      rows,
      "Monthly active users",
      String(mau.toLocaleString("en-IN")),
      "Customer Value Management",
    );
  } else if (config.subscriptionEnabled !== false) {
    pushRow(rows, "Subscription", "Enabled", "Customer Value Management");
  }

  if (config.additionalContactsEnabled && config.additionalContactSlab) {
    pushRow(rows, "Additional contacts slab", String(config.additionalContactSlab), "Add-ons");
  }
}

function summarizeTicketingConfig(config, rows) {
  const users = positiveCount(config.userCount);
  if (users) {
    pushRow(rows, "Users", String(users), "Ticketing License");
  }

  const tickets = positiveCount(config.includedTickets);
  if (tickets) {
    pushRow(rows, "Included tickets", String(tickets.toLocaleString("en-IN")), "Ticketing License");
  }

  if (config.additionalUsersEnabled && positiveCount(config.additionalUserCount)) {
    pushRow(
      rows,
      "Additional users",
      `+${positiveCount(config.additionalUserCount)}`,
      "Add-ons",
    );
  }

  if (config.additionalTicketsEnabled && config.additionalTicketSlab) {
    pushRow(rows, "Additional tickets slab", String(config.additionalTicketSlab), "Add-ons");
  }
}

function summarizeMidPeriodAddons(config, rows) {
  const mid = config.midPeriodAddons || {};
  if (mid.humanAgent?.enabled) {
    pushRow(
      rows,
      "Human agents",
      mid.humanAgent.count ? String(mid.humanAgent.count) : "Enabled",
      "Add-ons",
    );
  }
  if (mid.queueCapacity?.enabled || mid.phoneNumbers?.enabled) {
    const queue = mid.queueCapacity?.enabled ? mid.queueCapacity : mid.phoneNumbers;
    pushRow(
      rows,
      queue.label || "Queue capacity",
      queue.count ? String(queue.count) : "Enabled",
      "Add-ons",
    );
  }
  for (const [channelId, channel] of Object.entries(mid.channels || {})) {
    if (!channel?.enabled) {
      continue;
    }
    pushRow(
      rows,
      channel.label || channelId,
      channel.count ? `× ${channel.count}` : "Enabled",
      "Add-ons",
    );
  }
  if (mid.userLicense?.enabled) {
    pushRow(
      rows,
      "Additional users",
      mid.userLicense.additionalCount ? `+${mid.userLicense.additionalCount}` : "Enabled",
      "Add-ons",
    );
  }
  if (mid.contacts?.enabled) {
    pushRow(rows, "Contacts", mid.contacts.slab || "Enabled", "Add-ons");
  }
}

/**
 * Human-readable config rows for one assignment (plan, seats, modules, packs, etc.).
 * Quantity/config only — no prices.
 * @returns {{ label: string, value: string, section?: string }[]}
 */
export function summarizeProductRequestAssignment(assignment) {
  const config = assignment?.config || {};
  const rows = [];
  const pricingMode = String(config.pricingMode || "").toLowerCase();

  if (config.region) {
    pushRow(rows, "Region", String(config.region));
  }

  const billingCycle = formatBillingCycle(config.billingCycle);
  if (billingCycle) {
    pushRow(rows, "Billing cycle", billingCycle);
  }

  if (pricingMode === "ccaas" || config.licenseTier) {
    summarizeCcaasConfig(config, rows);
  } else if (pricingMode === "crm") {
    summarizeCrmConfig(config, rows);
  } else if (pricingMode === "campaign") {
    summarizeCampaignConfig(config, rows);
  } else if (pricingMode === "cdp") {
    summarizeCdpConfig(config, rows);
  } else if (pricingMode === "value-management") {
    summarizeValueManagementConfig(config, rows);
  } else if (pricingMode === "ticketing") {
    summarizeTicketingConfig(config, rows);
  } else {
    // Fallback for older/unknown configs.
    if (config.userCount) {
      summarizeCrmConfig(config, rows);
    }
    if (config.contactCount && !rows.some((row) => row.label === "Included contacts")) {
      const contacts = positiveCount(config.contactCount);
      if (contacts) {
        pushRow(rows, "Contacts", String(contacts));
      }
    }
  }

  summarizeMidPeriodAddons(config, rows);

  if (Array.isArray(config.renewalAddonSelection) && config.renewalAddonSelection.length) {
    pushRow(rows, "Renewal add-ons selected", config.renewalAddonSelection.join(", "), "Add-ons");
  }

  return rows;
}

/**
 * Group detail rows by optional section for invoice-like display.
 * Rows without a section stay in an untitled group (section === "").
 * @returns {{ section: string, rows: { label: string, value: string }[] }[]}
 */
export function groupProductRequestDetailRows(details = []) {
  const groups = [];
  const indexBySection = new Map();

  for (const row of details) {
    const section = String(row?.section || "").trim();
    let group = indexBySection.get(section);
    if (!group) {
      group = { section, rows: [] };
      indexBySection.set(section, group);
      groups.push(group);
    }
    group.rows.push({ label: row.label, value: row.value });
  }

  return groups;
}

/**
 * Line items for the customer request details modal.
 * productSummary is built 1:1 from assignments, so zip by index.
 */
export function buildProductRequestDetailLines(request) {
  const summaries = Array.isArray(request?.productSummary) ? request.productSummary : [];
  const assignments = Array.isArray(request?.assignments) ? request.assignments : [];
  const count = Math.max(summaries.length, assignments.length);

  if (!count) {
    return [];
  }

  return Array.from({ length: count }, (_, index) => {
    const summary = summaries[index] || {};
    const assignment = assignments[index] || null;
    const changeType = summary.changeType || assignment?.changeType || "new";
    const productId = summary.productId || assignment?.productId || "";

    return {
      key: `${productId || "product"}-${index}`,
      name: summary.name || productId || "Product",
      branchLabel: summary.branchLabel || "",
      billingLabel: summary.billingLabel || summary.branchLabel || "",
      changeTypeLabel: summary.changeTypeLabel || getChangeTypeLabel(changeType),
      priceLabel: summary.priceLabel || "Pending sales review",
      details: summarizeProductRequestAssignment(assignment),
    };
  });
}
