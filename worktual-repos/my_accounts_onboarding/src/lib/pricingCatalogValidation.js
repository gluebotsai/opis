const PRODUCT_LABELS = {
  "contact-center": "Contact Center",
  crm: "CRM",
  cdp: "CDP",
  campaign: "Campaign",
  "value-management": "Value Management",
  ticketing: "Ticketing",
};

const PLAN_LABELS = {
  starter: "Starter",
  growth: "Growth",
  pro: "Pro",
  enterprise: "Enterprise",
};

const FIELD_LABELS = {
  monthlyBasePrice: "Monthly base price",
  monthlyPrice: "Monthly price",
  userLicenseRate: "User license rate",
  includedContacts: "Included contacts",
  includedTickets: "Included tickets",
  includedTicketRate: "Included ticket rate",
  implementationFee: "Implementation fee",
  customerProfiles: "Customer profiles",
  dataSources: "Data sources",
  monthlyActiveUsers: "Monthly active users",
  contacts: "Contacts",
  tickets: "Tickets",
  perContactRate: "Per-contact rate",
  perTicketRate: "Per-ticket rate",
  rate: "Rate",
  defaultCount: "Default count",
  additionalAgentRate: "Additional agent price",
  telcoLineCharge: "Telco line charge",
  smsCount: "SMS message count",
  emailCount: "Email count",
  botSessions: "Bot sessions",
  voiceBotMinutes: "VoiceBot minutes",
  monthlyPerUser: "Monthly per user",
  annualPerUser: "Annual per user",
};

const NUMERIC_FIELD_KEY =
  /price|rate|fee|cost|amount|total|subtotal|minutes|sessions|contacts|tickets|users|profiles|sources|count/i;

function isPlainObject(value) {
  return value != null && typeof value === "object" && !Array.isArray(value);
}

function humanizeKey(key) {
  if (FIELD_LABELS[key]) {
    return FIELD_LABELS[key];
  }

  return String(key)
    .replace(/([A-Z])/g, " $1")
    .replace(/[_-]+/g, " ")
    .trim()
    .replace(/^\w/, (char) => char.toUpperCase());
}

export function humanizeCatalogFieldPath(path) {
  const segments = String(path).replace(/^catalog\./, "").split(".");

  if (segments[0] === "products" && segments.length >= 3) {
    const product = PRODUCT_LABELS[segments[1]] || humanizeKey(segments[1]);
    const fieldKey = segments[segments.length - 1];
    const field = FIELD_LABELS[fieldKey] || humanizeKey(fieldKey);

    if (segments[2] === "tierDefaultVolumes" && segments.length >= 5) {
      const plan = PLAN_LABELS[segments[3]] || humanizeKey(segments[3]);
      return `${product} → ${plan} → ${field}`;
    }

    if (segments[2] === "tierAgentRates" && segments.length >= 4) {
      const plan = PLAN_LABELS[segments[3]] || humanizeKey(segments[3]);
      return `${product} → ${plan} agent price`;
    }

    const middle = segments
      .slice(2, -1)
      .filter((part) => part !== "base")
      .map((part) => PLAN_LABELS[part] || humanizeKey(part));

    return [product, ...middle, field].filter(Boolean).join(" → ");
  }

  if (segments[0] === "shared" && segments.length >= 2) {
    const section = humanizeKey(segments[1]);
    const field = humanizeKey(segments[segments.length - 1]);
    return `Shared → ${section} → ${field}`;
  }

  if (segments[0] === "regionPricing" && segments.length >= 2) {
    if (segments.length === 2) {
      return `Region ${segments[1]}`;
    }

    const region = segments[1];
    const innerLabel = humanizeCatalogFieldPath(`catalog.${segments.slice(2).join(".")}`);
    return `${innerLabel} (${region})`;
  }

  return segments.map(humanizeKey).join(" → ");
}

export function isValidCatalogNumericValue(
  value,
  { allowCustom = false, allowEmpty = false } = {},
) {
  const normalized = String(value ?? "").trim();
  if (!normalized) {
    return allowEmpty;
  }

  if (allowCustom && normalized.toLowerCase() === "custom") {
    return true;
  }

  return /^-?\d+(\.\d+)?$/.test(normalized);
}

export function sanitizeNumericInput(raw) {
  const value = String(raw ?? "");
  if (value === "") {
    return "";
  }

  let result = "";
  let hasDot = false;

  for (const char of value) {
    if (char >= "0" && char <= "9") {
      result += char;
      continue;
    }

    if (char === "." && !hasDot) {
      result += char;
      hasDot = true;
    }
  }

  return result;
}

export function sanitizeNumericOrCustomInput(raw) {
  const value = String(raw ?? "");
  if (value === "") {
    return "";
  }

  const lettersOnly = value.replace(/[^a-z]/gi, "").toLowerCase();
  if (lettersOnly && "custom".startsWith(lettersOnly)) {
    return value.replace(/[^0-9.custom]/gi, "");
  }

  if (/^custom$/i.test(value.trim())) {
    return "custom";
  }

  return sanitizeNumericInput(value);
}

const NUMERIC_CONTROL_KEYS = new Set([
  "Backspace",
  "Delete",
  "Tab",
  "Enter",
  "Escape",
  "ArrowLeft",
  "ArrowRight",
  "ArrowUp",
  "ArrowDown",
  "Home",
  "End",
]);

export function blockNonNumericKeyDown(event, { allowCustom = false, currentValue = "" } = {}) {
  if (event.ctrlKey || event.metaKey || event.altKey) {
    return;
  }

  if (NUMERIC_CONTROL_KEYS.has(event.key)) {
    return;
  }

  if (/^\d$/.test(event.key)) {
    return;
  }

  if (event.key === "." && !String(currentValue).includes(".")) {
    return;
  }

  if (allowCustom && /^[a-z]$/i.test(event.key)) {
    return;
  }

  event.preventDefault();
}

export function handleNumericPaste(event, { allowCustom = false, onValue }) {
  event.preventDefault();
  const pasted = event.clipboardData?.getData("text") ?? "";
  const input = event.target;
  const start = input.selectionStart ?? 0;
  const end = input.selectionEnd ?? 0;
  const current = input.value ?? "";
  const merged = `${current.slice(0, start)}${pasted}${current.slice(end)}`;
  const sanitized = allowCustom ? sanitizeNumericOrCustomInput(merged) : sanitizeNumericInput(merged);
  onValue(sanitized);
}

function sanitizeNumericFieldValue(value, path) {
  const allowCustom = fieldAllowsCustom(path);
  if (allowCustom) {
    return sanitizeNumericOrCustomInput(value);
  }
  return sanitizeNumericInput(value);
}

function sanitizeNumericFields(value, path = "catalog") {
  if (Array.isArray(value)) {
    return value.map((entry, index) => sanitizeNumericFields(entry, `${path}[${index}]`));
  }

  if (!isPlainObject(value)) {
    return value;
  }

  const result = {};

  for (const [key, entry] of Object.entries(value)) {
    const nextPath = `${path}.${key}`;

    if (isPlainObject(entry) || Array.isArray(entry)) {
      result[key] = sanitizeNumericFields(entry, nextPath);
      continue;
    }

    if (NUMERIC_FIELD_KEY.test(key)) {
      result[key] = sanitizeNumericFieldValue(entry, nextPath);
      continue;
    }

    result[key] = entry;
  }

  return result;
}

export function sanitizePricingCatalogPayload(payload) {
  if (!isPlainObject(payload)) {
    return payload;
  }

  return sanitizeNumericFields(payload);
}

function fieldAllowsCustom(path) {
  return /\.tierDefaultVolumes\.|\.tierAgentRates\./i.test(path);
}

function collectNumericFieldErrors(value, path = "catalog", errors = []) {
  if (Array.isArray(value)) {
    value.forEach((entry, index) => collectNumericFieldErrors(entry, `${path}[${index}]`, errors));
    return errors;
  }

  if (!isPlainObject(value)) {
    return errors;
  }

  for (const [key, entry] of Object.entries(value)) {
    const nextPath = `${path}.${key}`;

    if (isPlainObject(entry) || Array.isArray(entry)) {
      collectNumericFieldErrors(entry, nextPath, errors);
      continue;
    }

    if (!NUMERIC_FIELD_KEY.test(key)) {
      continue;
    }

    const allowCustom = fieldAllowsCustom(nextPath);
    const normalized = String(entry ?? "").trim();

    if (!normalized) {
      errors.push({
        path: nextPath,
        label: humanizeCatalogFieldPath(nextPath),
        value: "",
        message: "This field is required.",
      });
      continue;
    }

    if (!isValidCatalogNumericValue(entry, { allowCustom })) {
      errors.push({
        path: nextPath,
        label: humanizeCatalogFieldPath(nextPath),
        value: String(entry),
        message: allowCustom
          ? `Enter a number or "custom".`
          : `Enter numbers only (no letters or symbols).`,
      });
    }
  }

  return errors;
}

export function validatePricingCatalogPayload(payload) {
  const errors = [];

  if (!isPlainObject(payload)) {
    return [{ path: "catalog", label: "Catalog", value: "", message: "Catalog data is invalid." }];
  }

  if (payload.version !== undefined) {
    const version = Number(payload.version);
    if (!Number.isFinite(version) || version < 1) {
      errors.push({
        path: "catalog.version",
        label: "Catalog version",
        value: String(payload.version),
        message: "Must be a positive number.",
      });
    }
  }

  errors.push(...collectNumericFieldErrors(payload));

  return errors;
}

export function formatPricingCatalogValidationErrors(errors) {
  if (!errors.length) {
    return "";
  }

  if (errors.length === 1) {
    const [error] = errors;
    const valueHint =
      error.value && error.message !== "This field is required."
        ? ` You entered "${error.value}".`
        : "";
    return `${error.label}: ${error.message}${valueHint}`;
  }

  const preview = errors
    .slice(0, 4)
    .map((error) => `• ${error.label}: ${error.message}`)
    .join("\n");

  const remainder = errors.length > 4 ? `\n• …and ${errors.length - 4} more field(s).` : "";

  return `Fix ${errors.length} pricing fields before saving:\n${preview}${remainder}`;
}

export function assertValidPricingCatalogPayload(payload) {
  const errors = validatePricingCatalogPayload(payload);
  if (errors.length) {
    throw new Error(formatPricingCatalogValidationErrors(errors));
  }
}
