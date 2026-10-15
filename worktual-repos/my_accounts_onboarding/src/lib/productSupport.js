export const SUPPORT_PRIORITIES = [
  { value: "low", label: "Low", hint: "General question" },
  { value: "medium", label: "Medium", hint: "Affecting work" },
  { value: "high", label: "High", hint: "Service impacted" },
  { value: "urgent", label: "Urgent", hint: "Business stopped" },
];

export const SUPPORT_STATUS_OPTIONS = [
  { value: "all", label: "All statuses" },
  { value: "open", label: "Open" },
  { value: "in_progress", label: "In progress" },
  { value: "waiting_on_customer", label: "Waiting on you" },
  { value: "resolved", label: "Resolved" },
  { value: "closed", label: "Closed" },
];

export const SUPPORT_DATE_FILTERS = [
  { value: "7", label: "Last 7 days" },
  { value: "30", label: "Last 30 days" },
  { value: "90", label: "Last 90 days" },
  { value: "all", label: "All time" },
];

export const ACCOUNT_PRODUCT_VALUE = "account";

const GLOBAL_CATEGORIES = [
  { value: "login_portal", label: "Login / portal access" },
  { value: "invoice_payment", label: "Invoice / payment" },
  { value: "subscription_renewal", label: "Subscription / renewal" },
  { value: "contract_commercial", label: "Contract / commercial" },
  { value: "other", label: "Other" },
];

const PRODUCT_CATEGORIES = {
  "contact-center": [
    { value: "agent_access", label: "Agent / seat access" },
    { value: "voice_quality", label: "Voice / call quality" },
    { value: "channels", label: "SMS / WhatsApp / channels" },
    { value: "usage_limits", label: "Usage / limits" },
    { value: "configuration", label: "Configuration change" },
    { value: "other", label: "Other" },
  ],
  campaign: [
    { value: "not_sending", label: "Campaign not sending" },
    { value: "contacts_audience", label: "Contacts / audience" },
    { value: "channel_limits", label: "Channel limits" },
    { value: "templates", label: "Template / content" },
    { value: "other", label: "Other" },
  ],
  crm: [
    { value: "user_licenses", label: "User licenses" },
    { value: "contacts_data", label: "Contacts / data" },
    { value: "integration", label: "Integration" },
    { value: "other", label: "Other" },
  ],
  cdp: [
    { value: "profiles", label: "Customer profiles" },
    { value: "data_sources", label: "Data sources" },
    { value: "integration", label: "Integration" },
    { value: "other", label: "Other" },
  ],
  "value-management": [
    { value: "users_mau", label: "Monthly active users" },
    { value: "reporting", label: "Reporting / analytics" },
    { value: "other", label: "Other" },
  ],
  ticketing: [
    { value: "agent_access", label: "Agent access" },
    { value: "workflow", label: "Ticket workflow" },
    { value: "sla_routing", label: "SLA / routing" },
    { value: "other", label: "Other" },
  ],
};

export function buildSupportProductOptions(activeProducts = []) {
  const options = [
    {
      value: ACCOUNT_PRODUCT_VALUE,
      label: "Account & billing",
      subscriptionId: null,
      productId: null,
      subscriptionKey: null,
    },
  ];

  for (const entry of activeProducts) {
    options.push({
      value: entry.key,
      label: `${entry.productName} (${entry.branchLabel})`,
      subscriptionId: entry.subscriptionId || null,
      productId: entry.productId,
      subscriptionKey: entry.key,
    });
  }

  return options;
}

export function getSupportCategories(productSelection, activeProducts = []) {
  if (!productSelection || productSelection === ACCOUNT_PRODUCT_VALUE) {
    return GLOBAL_CATEGORIES;
  }

  const product = activeProducts.find((entry) => entry.key === productSelection);
  const productId =
    product?.productId ||
    (productSelection.includes(":") ? productSelection.split(":").slice(-2, -1)[0] : productSelection);

  return PRODUCT_CATEGORIES[productId] || GLOBAL_CATEGORIES;
}

export function getSupportPriorityLabel(value) {
  return SUPPORT_PRIORITIES.find((entry) => entry.value === value)?.label || value;
}

export function getSupportStatusLabel(value) {
  return SUPPORT_STATUS_OPTIONS.find((entry) => entry.value === value)?.label || value;
}

export function supportStatusClassName(status) {
  switch (status) {
    case "open":
      return "support-status-pill support-status-pill--open";
    case "in_progress":
      return "support-status-pill support-status-pill--progress";
    case "waiting_on_customer":
      return "support-status-pill support-status-pill--waiting";
    case "resolved":
      return "support-status-pill support-status-pill--resolved";
    case "closed":
      return "support-status-pill support-status-pill--closed";
    default:
      return "support-status-pill";
  }
}

export function supportPriorityClassName(priority) {
  switch (priority) {
    case "low":
      return "support-priority-pill support-priority-pill--low";
    case "medium":
      return "support-priority-pill support-priority-pill--medium";
    case "high":
      return "support-priority-pill support-priority-pill--high";
    case "urgent":
      return "support-priority-pill support-priority-pill--urgent";
    default:
      return "support-priority-pill";
  }
}

export function findSupportProductOption(options, value) {
  return options.find((entry) => entry.value === value) || options[0] || null;
}

export function getCategoryLabel(productSelection, categoryValue) {
  return (
    getSupportCategories(productSelection).find((entry) => entry.value === categoryValue)?.label ||
    categoryValue
  );
}
