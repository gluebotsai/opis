/**
 * Ported from src/lib/addon-pricing.ts. AddonPricingModel is a plain string
 * union here (no @prisma/client dependency in the Vite bundle).
 */

export type AddonPricingModel = "flat" | "per_unit" | "stepped" | "tiered";

export type AddonTierPriceInput = {
  minQty: number;
  maxQty: number | null;
  unitPrice: number;
};

export type AddonPriceInput = {
  pricingModel: AddonPricingModel;
  flatPrice?: number | null;
  unitPrice?: number | null;
  stepSize?: number | null;
  stepPrice?: number | null;
  tiers?: AddonTierPriceInput[];
};

/**
 * Compute addon line amount for a requested quantity.
 * Stepped packs round quantity up to the next full pack.
 * Tiered uses the single band that contains qty (volume rate), not progressive.
 */
export function priceAddon(addon: AddonPriceInput, qty: number): number {
  const quantity = Number(qty);
  if (!Number.isFinite(quantity) || quantity < 0) {
    throw new Error("Quantity must be a non-negative number.");
  }

  switch (addon.pricingModel) {
    case "flat": {
      const price = Number(addon.flatPrice);
      if (!Number.isFinite(price)) {
        throw new Error("Flat price is required for flat addons.");
      }
      return quantity === 0 ? 0 : price;
    }
    case "per_unit": {
      const unit = Number(addon.unitPrice);
      if (!Number.isFinite(unit)) {
        throw new Error("Unit price is required for per-unit addons.");
      }
      return quantity * unit;
    }
    case "stepped": {
      const stepSize = Number(addon.stepSize);
      const stepPrice = Number(addon.stepPrice);
      if (!Number.isFinite(stepSize) || stepSize <= 0) {
        throw new Error("Step size must be a positive integer.");
      }
      if (!Number.isFinite(stepPrice)) {
        throw new Error("Step price is required for stepped addons.");
      }
      if (quantity === 0) return 0;
      const packs = Math.ceil(quantity / stepSize);
      return packs * stepPrice;
    }
    case "tiered": {
      const tiers = [...(addon.tiers ?? [])].sort(
        (a, b) => a.minQty - b.minQty,
      );
      if (!tiers.length) {
        throw new Error("At least one tier is required for tiered addons.");
      }
      if (quantity === 0) return 0;
      const band = tiers.find((tier) => {
        if (quantity < tier.minQty) return false;
        if (tier.maxQty == null) return true;
        return quantity <= tier.maxQty;
      });
      if (!band) {
        throw new Error("No pricing tier matches this quantity.");
      }
      return quantity * band.unitPrice;
    }
    default: {
      const _exhaustive: never = addon.pricingModel;
      throw new Error(`Unsupported pricing model: ${_exhaustive}`);
    }
  }
}

export function formatAddonAmount(amount: number, currency = "USD"): string {
  try {
    return new Intl.NumberFormat(undefined, {
      style: "currency",
      currency: currency || "USD",
      maximumFractionDigits: 2,
    }).format(amount);
  } catch {
    return `${currency} ${amount.toFixed(2)}`;
  }
}
