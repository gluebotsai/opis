import { ADMIN_PRODUCT_ORDER } from "./pricingCatalogDefaults.js";

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
  additionalUserLicenseRate: "Additional user rate",
  customerProfiles: "Customer profiles",
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
  voiceBotMinutes: "Minutes count",
  agentCount: "Agent count",
  whatsAppCount: "WhatsApp message count",
  instagramCount: "Instagram message count",
  facebookCount: "Facebook message count",
  webChatCount: "Web chat session count",
  monthlyPerUser: "Monthly per user",
  annualPerUser: "Annual per user",
};

const NUMERIC_FIELD_KEY =
  /price|rate|fee|cost|amount|total|subtotal|minutes|sessions|contacts|tickets|users|profiles|sources|count/i;

/** Metadata keys that match NUMERIC_FIELD_KEY by substring (e.g. rateLabel, totalKey). */
const NON_NUMERIC_FIELD_KEY =
  /(?:Label|Key|Id|Name|Description|Capability|Placeholder|Subtitle|Title)$/i;

function isNumericCatalogFieldKey(key: any) {
  if (!key || NON_NUMERIC_FIELD_KEY.test(key)) {
    return false;
  }
  if (/^(id|label|optionId|sourceModuleId|capability|moduleName|custom|enabled)$/i.test(key)) {
    return false;
  }
  return NUMERIC_FIELD_KEY.test(key);
}

function isPlainObject(value: any) {
  return value != null && typeof value === "object" && !Array.isArray(value);
}

function humanizeKey(key: any) {
  if ((FIELD_LABELS as Record<string, any>)[key]) {
    return (FIELD_LABELS as Record<string, any>)[key];
  }

  return String(key)
    .replace(/([A-Z])/g, " $1")
    .replace(/[_-]+/g, " ")
    .trim()
    .replace(/^\w/, (char: any) => char.toUpperCase());
}

export function humanizeCatalogFieldPath(path: any): string {
  const segments = String(path).replace(/^catalog\./, "").split(".");

  if (segments[0] === "products" && segments.length >= 3) {
    const productKey = segments[1]!;
    const product = (PRODUCT_LABELS as Record<string, string>)[productKey] || humanizeKey(productKey);
    const fieldKey = segments[segments.length - 1]!;
    const field = (FIELD_LABELS as Record<string, string>)[fieldKey] || humanizeKey(fieldKey);

    if (segments[2] === "tierDefaultVolumes" && segments.length >= 5) {
      const planKey = segments[3]!;
      const plan = (PLAN_LABELS as Record<string, string>)[planKey] || humanizeKey(planKey);
      return `${product} → ${plan} → ${field}`;
    }

    if (segments[2] === "tierAgentRates" && segments.length >= 4) {
      const planKey = segments[3]!;
      const plan = (PLAN_LABELS as Record<string, string>)[planKey] || humanizeKey(planKey);
      return `${product} → ${plan} agent price`;
    }

    const middle = segments
      .slice(2, -1)
      .filter((part: any) => part !== "base")
      .map((part: any) => (PLAN_LABELS as Record<string, any>)[part] || humanizeKey(part));

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
    const innerLabel: string = humanizeCatalogFieldPath(`catalog.${segments.slice(2).join(".")}`);
    return `${innerLabel} (${region})`;
  }

  return segments.map(humanizeKey).join(" → ");
}

export function isValidCatalogNumericValue(
  value: any,
  { allowCustom = false, allowEmpty = false }: any = {},
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

export function sanitizeNumericInput(raw: any) {
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

export function sanitizeNumericOrCustomInput(raw: any) {
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

export function blockNonNumericKeyDown(event: any, { allowCustom = false, currentValue = "" }: any = {}) {
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

export function handleNumericPaste(event: any, { allowCustom = false, onValue }: any) {
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

function sanitizeNumericFieldValue(value: any, path: any) {
  const allowCustom = fieldAllowsCustom(path);
  if (allowCustom) {
    return sanitizeNumericOrCustomInput(value);
  }
  return sanitizeNumericInput(value);
}

function sanitizeNumericFields(value: any, path: any = "catalog"): any {
  if (Array.isArray(value)) {
    return value.map((entry: any, index: any) => sanitizeNumericFields(entry, `${path}[${index}]`));
  }

  if (!isPlainObject(value)) {
    return value;
  }

  const result: Record<string, any> = {};

  for (const [key, entry] of Object.entries(value)) {
    const nextPath = `${path}.${key}`;

    if (isPlainObject(entry) || Array.isArray(entry)) {
      result[key] = sanitizeNumericFields(entry, nextPath);
      continue;
    }

    if (isNumericCatalogFieldKey(key)) {
      result[key] = sanitizeNumericFieldValue(entry, nextPath);
      continue;
    }

    result[key] = entry;
  }

  return result;
}

export function sanitizePricingCatalogPayload(payload: any) {
  if (!isPlainObject(payload)) {
    return payload;
  }

  return sanitizeNumericFields(payload);
}

function coerceEmptyNumericFields(value: any, path: any = "catalog"): any {
  if (Array.isArray(value)) {
    return value.map((entry: any, index: any) => coerceEmptyNumericFields(entry, `${path}[${index}]`));
  }

  if (!isPlainObject(value)) {
    return value;
  }

  const result: Record<string, any> = {};

  for (const [key, entry] of Object.entries(value)) {
    const nextPath = `${path}.${key}`;

    if (isPlainObject(entry) || Array.isArray(entry)) {
      result[key] = coerceEmptyNumericFields(entry, nextPath);
      continue;
    }

    if (isNumericCatalogFieldKey(key)) {
      // Implementation fee must be entered by admin — do not coerce empty → 0.
      if (key === "implementationFee") {
        result[key] = entry;
        continue;
      }
      const normalized = String(entry ?? "").trim();
      result[key] = normalized === "" ? "0" : entry;
      continue;
    }

    result[key] = entry;
  }

  return result;
}

/** Empty numeric leaves become "0"; explicit values stay. implementationFee is left empty. */
export function coerceEmptyNumericFieldsToZero(value: any) {
  return coerceEmptyNumericFields(value);
}

/** @deprecated Prefer coerceEmptyNumericFieldsToZero — empty leaves become "0". */
export function coerceEmptyNumericFieldsToOne(value: any) {
  return coerceEmptyNumericFieldsToZero(value);
}

function fieldAllowsCustom(path: any) {
  return /\.tierDefaultVolumes\.|\.tierAgentRates\./i.test(path);
}

function collectNumericFieldErrors(value: any, path: any = "catalog", errors: any = []) {
  if (Array.isArray(value)) {
    value.forEach((entry: any, index: any) => collectNumericFieldErrors(entry, `${path}[${index}]`, errors));
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

    if (!isNumericCatalogFieldKey(key)) {
      continue;
    }

    // Legacy product-level CC fee; per-plan fees live under licenseTiers.*.implementationFee
    if (
      key === "implementationFee" &&
      /\.products\.contact-center\.implementationFee$/.test(nextPath)
    ) {
      continue;
    }

    const allowCustom = fieldAllowsCustom(nextPath);
    const normalized = String(entry ?? "").trim();

    if (!normalized) {
      // Allow empty implementation fees (0 / custom quotes); other numerics stay required.
      if (key === "implementationFee") {
        continue;
      }
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

export function validatePricingCatalogPayload(payload: any) {
  const errors: any[] = [];

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
  errors.push(...collectProductLabelErrors(payload));

  return errors;
}

/**
 * Validate only one product (and its regionPricing slices). Used when saving the
 * active Admin Pricing product tab without requiring the rest of the catalog.
 */
export function validatePricingCatalogProductPayload(payload: any, productId: any) {
  const errors: any = [];

  if (!isPlainObject(payload)) {
    return [{ path: "catalog", label: "Catalog", value: "", message: "Catalog data is invalid." }];
  }

  if (!productId || productId === "regions") {
    return errors;
  }

  const products = isPlainObject(payload.products) ? payload.products : {};
  const product = products[productId];
  const label = String(product?.label ?? "").trim();
  if (!label) {
    errors.push({
      path: `catalog.products.${productId}.label`,
      label: `${(PRODUCT_LABELS as Record<string, any>)[productId] || productId} → Product name`,
      value: "",
      message: "This field is required.",
    });
  }

  if (product) {
    errors.push(...collectNumericFieldErrors(product, `catalog.products.${productId}`));
  }

  const regionPricing = isPlainObject(payload.regionPricing) ? payload.regionPricing : {};
  for (const [region, slice] of Object.entries(regionPricing)) {
    const regionProduct = (slice as any)?.products?.[productId];
    if (!regionProduct) {
      continue;
    }
    errors.push(
      ...collectNumericFieldErrors(
        regionProduct,
        `catalog.regionPricing.${region}.products.${productId}`,
      ),
    );
  }

  return errors;
}

/** Validate regions/shared only (Admin Pricing "Regions" tab). */
export function validatePricingCatalogRegionsPayload(payload: any) {
  const errors: any = [];

  if (!isPlainObject(payload)) {
    return [{ path: "catalog", label: "Catalog", value: "", message: "Catalog data is invalid." }];
  }

  if (payload.shared) {
    errors.push(...collectNumericFieldErrors(payload.shared, "catalog.shared"));
  }

  const regionPricing = isPlainObject(payload.regionPricing) ? payload.regionPricing : {};
  for (const [region, slice] of Object.entries(regionPricing)) {
    if ((slice as any)?.shared) {
      errors.push(
        ...collectNumericFieldErrors((slice as any).shared, `catalog.regionPricing.${region}.shared`),
      );
    }
  }

  return errors;
}

function collectProductLabelErrors(payload: any) {
  const errors: any[] = [];
  const products = isPlainObject(payload.products) ? payload.products : {};

  for (const productId of ADMIN_PRODUCT_ORDER) {
    const label = String(products[productId]?.label ?? "").trim();
    if (label) {
      continue;
    }

    errors.push({
      path: `catalog.products.${productId}.label`,
      label: `${(PRODUCT_LABELS as Record<string, any>)[productId] || productId} → Product name`,
      value: "",
      message: "This field is required.",
    });
  }

  return errors;
}

export function formatPricingCatalogValidationErrors(errors: any) {
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
    .map((error: any) => `• ${error.label}: ${error.message}`)
    .join("\n");

  const remainder = errors.length > 4 ? `\n• …and ${errors.length - 4} more field(s).` : "";

  return `Fix ${errors.length} pricing fields before saving:\n${preview}${remainder}`;
}

export function assertValidPricingCatalogPayload(payload: any) {
  const errors = validatePricingCatalogPayload(payload);
  if (errors.length) {
    throw new Error(formatPricingCatalogValidationErrors(errors));
  }
}

export function assertValidPricingCatalogScope(payload: any, scopeProductId: any) {
  const errors =
    !scopeProductId || scopeProductId === "regions"
      ? validatePricingCatalogRegionsPayload(payload)
      : validatePricingCatalogProductPayload(payload, scopeProductId);
  if (errors.length) {
    throw new Error(formatPricingCatalogValidationErrors(errors));
  }
}
