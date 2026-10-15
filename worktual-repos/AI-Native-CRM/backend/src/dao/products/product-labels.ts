import type {
  AddonMeterKey,
  AddonPricingModel,
  ProductBillingFrequency,
  ProductBillingType,
  ProductStatus,
  ProductType,
} from "@prisma/client";

export type ProductStatusLabel = ProductStatus;

export const PRODUCT_STATUS_LABELS: Record<ProductStatusLabel, string> = {
  draft: "Draft",
  active: "Active",
  archived: "Archived",
};

export const PRODUCT_TYPE_LABELS: Record<ProductType, string> = {
  fixed: "Fixed price",
  customizable: "Customizable",
};

export const PRODUCT_BILLING_TYPE_LABELS: Record<ProductBillingType, string> = {
  one_time: "One-time",
  recurring: "Recurring",
};

export const PRODUCT_BILLING_FREQUENCY_LABELS: Record<
  ProductBillingFrequency,
  string
> = {
  monthly: "Monthly",
  quarterly: "Quarterly",
  annual: "Annual",
};

export const ADDON_PRICING_MODEL_LABELS: Record<AddonPricingModel, string> = {
  flat: "Flat",
  per_unit: "Per unit",
  stepped: "Stepped (packs)",
  tiered: "Tiered",
};

export const ADDON_METER_KEY_LABELS: Record<AddonMeterKey, string> = {
  seat: "Seat",
  minute: "Minute",
  session: "Session",
  email: "Email",
  agent: "Agent",
  flat: "Flat",
  custom: "Custom",
};

export type AddonTierInput = {
  minQty: number;
  maxQty: number | null;
  unitPrice: number;
};

export type AddonInput = {
  id?: string;
  name: string;
  unitLabel?: string | null;
  meterKey?: AddonMeterKey | null;
  isOverage?: boolean;
  pricingModel: AddonPricingModel;
  flatPrice?: number | null;
  unitPrice?: number | null;
  stepSize?: number | null;
  stepPrice?: number | null;
  sortOrder?: number;
  tiers?: AddonTierInput[];
};

export type ProductOfferInput = {
  id?: string;
  name: string;
  code?: string | null;
  billingType?: ProductBillingType | null;
  billingFrequency?: ProductBillingFrequency | null;
  includedQty?: number | null;
  meterKey?: AddonMeterKey | null;
  sortOrder?: number;
  status?: ProductStatus;
};

export type CatalogRateUnitInput = {
  unitOfMeasure?: string | null;
  unitLabel?: string | null;
  meterKey?: string | null;
  billingFrequency?: string | null;
  offers?: Array<{ meterKey?: string | null }>;
  addons?: Array<{ unitLabel?: string | null; meterKey?: string | null }>;
};

function singularMeter(label?: string | null): string | null {
  const t = String(label || "").trim().toLowerCase();
  if (!t) return null;
  if (t.endsWith("ies") && t.length > 3) return `${t.slice(0, -3)}y`;
  if (t.endsWith("s") && !t.endsWith("ss") && t.length > 3) return t.slice(0, -1);
  return t;
}

function meterToUnit(meter?: string | null): string | null {
  const m = String(meter || "").trim().toLowerCase();
  if (!m || m === "flat" || m === "custom") return null;
  return m;
}

function uomToUnit(uom?: string | null): string | null {
  switch (String(uom || "").trim()) {
    case "per_agent":
      return "agent";
    case "per_seat":
      return "seat";
    case "per_ticket":
      return "ticket";
    default:
      return null;
  }
}

/** Catalog UoM / addon meter → "agent", "seat", … (null for flat). */
export function catalogRateUnitLabel(
  input?: CatalogRateUnitInput | null,
): string | null {
  if (!input) return null;
  const fromLabel = singularMeter(input.unitLabel);
  if (fromLabel) return fromLabel;
  const fromMeter = meterToUnit(input.meterKey);
  if (fromMeter) return fromMeter;
  const fromUom = uomToUnit(input.unitOfMeasure);
  if (fromUom) return fromUom;
  for (const offer of input.offers || []) {
    const unit = meterToUnit(offer.meterKey);
    if (unit) return unit;
  }
  for (const addon of input.addons || []) {
    const unit = singularMeter(addon.unitLabel) || meterToUnit(addon.meterKey);
    if (unit) return unit;
  }
  return null;
}

export function formatMoneyAmount(
  amount: number,
  currency: string,
): string {
  try {
    return new Intl.NumberFormat(undefined, {
      style: "currency",
      currency: currency || "USD",
      maximumFractionDigits: 2,
      minimumFractionDigits: 0,
    }).format(amount);
  } catch {
    return `${currency} ${amount.toFixed(2)}`;
  }
}

/** Unit list rate, e.g. "$1,000/agent" when priced per agent purchased. */
export function formatCatalogListRate(
  amount: number,
  currency: string,
  unit: string | null,
): string {
  const money = formatMoneyAmount(amount, currency);
  return unit ? `${money}/${unit}` : money;
}

export function formatProductPrice(
  price: string | null,
  currency: string,
  rate?: CatalogRateUnitInput | string | null,
): string {
  if (price == null || price === "") return "Contact for price";
  const n = Number(price);
  if (!Number.isFinite(n)) return "Contact for price";
  const opts: CatalogRateUnitInput | null =
    typeof rate === "string" ? { unitOfMeasure: rate } : rate || null;
  return formatCatalogListRate(n, currency, catalogRateUnitLabel(opts));
}

export function isProductStatus(value: string): value is ProductStatus {
  return value === "draft" || value === "active" || value === "archived";
}

export function isProductType(value: string): value is ProductType {
  return value === "fixed" || value === "customizable";
}

export function isAddonPricingModel(value: string): value is AddonPricingModel {
  return (
    value === "flat" ||
    value === "per_unit" ||
    value === "stepped" ||
    value === "tiered"
  );
}

export function isAddonMeterKey(value: string): value is AddonMeterKey {
  return (
    value === "seat" ||
    value === "minute" ||
    value === "session" ||
    value === "email" ||
    value === "agent" ||
    value === "flat" ||
    value === "custom"
  );
}

/** Accept legacy CSV/API aliases when importing. */
export function normalizeProductStatus(raw: string): ProductStatus {
  const v = raw.trim().toLowerCase();
  if (v === "available" || v === "active" || v === "publish") return "active";
  if (v === "unavailable" || v === "inactive" || v === "archived") {
    return "archived";
  }
  if (v === "draft") return "draft";
  return "draft";
}
