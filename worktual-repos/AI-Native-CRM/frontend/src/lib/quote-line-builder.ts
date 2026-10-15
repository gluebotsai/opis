/**
 * Build quote line payloads from catalog + user selections.
 * Quantity applies to fixed SKUs, offers (packs/seats), and each selected addon.
 */
import {
  priceAddon,
  type AddonPricingModel,
  type AddonPriceInput,
} from "@/lib/addon-pricing";
import type {
  QuoteFormAddon,
  QuoteFormOffer,
  QuoteFormProduct,
} from "@/services/quotes";

export type QuoteLinePayload = {
  productId: string;
  name: string;
  quantity: number;
  unitPrice: number;
};

export type QuoteBuildInput = {
  product: QuoteFormProduct;
  /** Units of fixed product, or units of selected offer. */
  quantity: number;
  offerId?: string | null;
  /** Selected addons with quantity (> 0). */
  addonQuantities: Record<string, number>;
};

function money(n: number) {
  return Math.round(n * 100) / 100;
}

function parseQty(raw: number): number | null {
  if (!Number.isFinite(raw) || raw <= 0) return null;
  return raw;
}

function offerUnitPrice(offer: QuoteFormOffer): number | null {
  const n = Number(offer.listPrice);
  return Number.isFinite(n) ? n : null;
}

function productUnitPrice(product: QuoteFormProduct): number | null {
  const n = Number(product.listPrice ?? product.basePrice ?? product.price);
  return Number.isFinite(n) ? n : null;
}

/** Prefer price-book listPrice as the commercial rate for the model's primary scalar. */
function addonPriceInput(addon: QuoteFormAddon): AddonPriceInput {
  const list = addon.listPrice != null ? Number(addon.listPrice) : null;
  const model = addon.pricingModel as AddonPricingModel;
  const flat =
    list != null && Number.isFinite(list) && model === "flat"
      ? list
      : addon.flatPrice != null
        ? Number(addon.flatPrice)
        : null;
  const unit =
    list != null && Number.isFinite(list) && model === "per_unit"
      ? list
      : addon.unitPrice != null
        ? Number(addon.unitPrice)
        : null;
  const stepPrice =
    list != null && Number.isFinite(list) && model === "stepped"
      ? list
      : addon.stepPrice != null
        ? Number(addon.stepPrice)
        : null;

  // Quote UX: flat catalog fees still multiply by qty (e.g. 3 language setups).
  if (model === "flat") {
    return {
      pricingModel: "per_unit",
      unitPrice: flat,
      flatPrice: null,
      stepSize: null,
      stepPrice: null,
      tiers: [],
    };
  }

  return {
    pricingModel: model,
    flatPrice: flat,
    unitPrice: unit,
    stepSize: addon.stepSize ?? null,
    stepPrice,
    tiers: (addon.tiers ?? []).map((t) => ({
      minQty: t.minQty,
      maxQty: t.maxQty,
      unitPrice: t.unitPrice,
    })),
  };
}

/**
 * Compute commercial amount for an addon at qty, then derive unitPrice so
 * backend amount = quantity * unitPrice stays consistent.
 */
function addonLine(
  product: QuoteFormProduct,
  addon: QuoteFormAddon,
  qty: number,
): { error: string } | QuoteLinePayload {
  try {
    const amount = money(priceAddon(addonPriceInput(addon), qty));
    const unitPrice = qty > 0 ? money(amount / qty) : 0;
    const unitHint = addon.unitLabel?.trim()
      ? ` × ${qty} ${addon.unitLabel.trim()}`
      : qty !== 1
        ? ` × ${qty}`
        : "";
    return {
      productId: product.id,
      name: `${product.name} — ${addon.name}${unitHint}`,
      quantity: qty,
      unitPrice,
    };
  } catch (err) {
    return {
      error:
        err instanceof Error
          ? err.message
          : `Could not price addon “${addon.name}”.`,
    };
  }
}

export function buildQuoteLines(input: QuoteBuildInput): {
  error: string | null;
  lines: QuoteLinePayload[];
  currency: string;
} {
  const { product } = input;
  const qty = parseQty(input.quantity);
  if (qty == null) {
    return {
      error: "Quantity must be greater than 0.",
      lines: [],
      currency: product.currency || "",
    };
  }

  const lines: QuoteLinePayload[] = [];
  let currency = product.currency || "";

  const isCustom =
    product.productType === "customizable" && product.offers.length > 0;

  if (isCustom) {
    const offer = product.offers.find((o) => o.id === input.offerId);
    if (!offer) {
      return {
        error: "Select a plan / offer for this product.",
        lines: [],
        currency,
      };
    }
    const unit = offerUnitPrice(offer);
    if (unit == null) {
      return {
        error: `No list or base price for offer “${offer.name}”.`,
        lines: [],
        currency,
      };
    }
    currency = offer.currency || currency;
    const meter = offer.meterKey?.trim();
    const qtyLabel =
      meter && qty !== 1
        ? ` × ${qty} ${meter}`
        : qty !== 1
          ? ` × ${qty}`
          : "";
    lines.push({
      productId: product.id,
      name: `${product.name} — ${offer.name}${qtyLabel}`,
      quantity: qty,
      unitPrice: money(unit),
    });

    for (const [addonId, rawQty] of Object.entries(input.addonQuantities)) {
      const addonQty = parseQty(rawQty);
      if (addonQty == null) continue;
      const addon = product.addons.find((a) => a.id === addonId);
      if (!addon) continue;
      if (
        addon.pricingModel === "tiered"
          ? !(addon.tiers && addon.tiers.length)
          : addon.listPrice == null &&
            addon.flatPrice == null &&
            addon.unitPrice == null &&
            addon.stepPrice == null
      ) {
        return {
          error: `No list or base price for addon “${addon.name}”.`,
          lines: [],
          currency,
        };
      }
      const line = addonLine(product, addon, addonQty);
      if ("error" in line) {
        return { error: line.error, lines: [], currency };
      }
      currency = addon.currency || currency;
      lines.push(line);
    }

    return { error: null, lines, currency };
  }

  const unit = productUnitPrice(product);
  if (unit == null) {
    return {
      error: `No list or base price for “${product.name}”.`,
      lines: [],
      currency,
    };
  }
  lines.push({
    productId: product.id,
    name: qty !== 1 ? `${product.name} × ${qty}` : product.name,
    quantity: qty,
    unitPrice: money(unit),
  });
  return { error: null, lines, currency };
}

export function estimateQuoteTotal(
  lines: QuoteLinePayload[],
  discountPctRaw: string | number,
): number {
  const subtotal = lines.reduce(
    (s, l) => s + money(l.quantity * l.unitPrice),
    0,
  );
  const discountPct = Math.min(
    100,
    Math.max(0, Number(discountPctRaw) || 0),
  );
  return money(subtotal * (1 - discountPct / 100));
}
