import {
  CHIP_BASE,
  TONE_NEUTRAL,
  TONE_MUTED,
  TONE_SUCCESS,
  TONE_WARNING,
} from "@/lib/ui-tones";

export type ProductStatusLabel = "draft" | "active" | "archived";

export const PRODUCT_STATUS_LABELS: Record<string, string> = {
  draft: "Draft",
  active: "Active",
  inactive: "Inactive",
  archived: "Archived",
};

export const PRODUCT_TYPE_LABELS: Record<string, string> = {
  fixed: "Fixed price",
  customizable: "Customizable",
};

export const PRODUCT_BILLING_TYPE_LABELS: Record<string, string> = {
  one_time: "One-time",
  recurring: "Recurring",
};

export const PRODUCT_BILLING_FREQUENCY_LABELS: Record<string, string> = {
  monthly: "Monthly",
  quarterly: "Quarterly",
  annual: "Annual",
};

export const ADDON_PRICING_MODEL_LABELS: Record<string, string> = {
  flat: "Flat",
  per_unit: "Per unit",
  stepped: "Stepped (packs)",
  tiered: "Tiered",
};

export function formatProductPrice(
  price: string | null,
  currency: string,
): string {
  if (price == null || price === "") return "Contact for price";
  const n = Number(price);
  if (!Number.isFinite(n)) return "Contact for price";
  try {
    return new Intl.NumberFormat(undefined, {
      style: "currency",
      currency: currency || "USD",
      maximumFractionDigits: 2,
    }).format(n);
  } catch {
    return `${currency} ${n.toFixed(2)}`;
  }
}

/** Brand-aligned status chip — semantic colors, no ad-hoc emerald/amber mix. */
export function productStatusChipClass(
  status: string,
  active = true,
): string {
  if (!active || status === "inactive" || status === "archived") {
    return `${CHIP_BASE} ${TONE_NEUTRAL}`;
  }
  if (status === "active") {
    return `${CHIP_BASE} ${TONE_SUCCESS}`;
  }
  if (status === "draft") {
    return `${CHIP_BASE} ${TONE_WARNING}`;
  }
  return `${CHIP_BASE} ${TONE_MUTED}`;
}
