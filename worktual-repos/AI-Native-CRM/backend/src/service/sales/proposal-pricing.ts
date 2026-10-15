/**
 * SQL/catalog pricing for V2 generate. Money is computed here, never invented
 * by the writer. Inventory DDL is forbidden; we only read existing columns.
 */

import { priceAddon, type AddonPriceInput } from "@/lib/addon-pricing";
import {
  catalogRateUnitLabel,
  formatCatalogListRate,
  formatMoneyAmount,
} from "@/dao/products/product-labels";

export type PricingCatalogProduct = {
  id: string;
  name: string;
  sku?: string | null;
  price?: string | number | null;
  currency?: string | null;
  unitOfMeasure?: string | null;
  billingFrequency?: string | null;
  unitLabel?: string | null;
  meterKey?: string | null;
  offers?: Array<{ meterKey?: string | null }>;
  addons?: Array<{ unitLabel?: string | null; meterKey?: string | null }>;
};

export type PricingCatalogAddon = {
  id: string;
  productId: string;
  name: string;
  pricingModel: AddonPriceInput["pricingModel"];
  flatPrice?: number | null;
  unitPrice?: number | null;
  stepSize?: number | null;
  stepPrice?: number | null;
  tiers?: AddonPriceInput["tiers"];
  unitLabel?: string | null;
  meterKey?: string | null;
};

export type PricingPlanLine = {
  productId?: string | null;
  sku?: string | null;
  name: string;
  quantity: number;
  addonId?: string | null;
};

export type PricingIssue = {
  code: "missing_price" | "missing_qty" | "qty_outside_tiers" | "unmatched_product";
  message: string;
  productName: string;
};

export type ComposedPricing = {
  schemaVersion: 1;
  currency: string;
  lines: Array<{
    token: string;
    productName: string;
    quantity: number;
    unitPrice: number | null;
    amount: number | null;
    unitLabel: string | null;
    rateDisplay: string;
    display: string;
  }>;
  total: number | null;
  totalToken: string;
  tokens: Record<string, string>;
  issues: PricingIssue[];
  sendBlocked: boolean;
};

const TBC = "To be confirmed";

function money(n: number, currency: string): string {
  return formatMoneyAmount(n, currency);
}

function rateUnitForLine(
  product: PricingCatalogProduct | null,
  addon?: PricingCatalogAddon | null,
): string | null {
  return catalogRateUnitLabel({
    unitOfMeasure: product?.unitOfMeasure,
    billingFrequency: product?.billingFrequency,
    unitLabel: addon?.unitLabel || product?.unitLabel,
    meterKey: addon?.meterKey || product?.meterKey,
    offers: product?.offers,
    addons: product?.addons,
  });
}

function emptyLine(
  token: string,
  productName: string,
  quantity: number,
): ComposedPricing["lines"][number] {
  return {
    token,
    productName,
    quantity,
    unitPrice: null,
    amount: null,
    unitLabel: null,
    rateDisplay: TBC,
    display: TBC,
  };
}

function matchProduct(
  line: PricingPlanLine,
  catalog: PricingCatalogProduct[],
): PricingCatalogProduct | null {
  const id = String(line.productId || "").trim();
  if (id) {
    const byId = catalog.find((p) => p.id === id);
    if (byId) return byId;
  }
  const sku = String(line.sku || "").trim().toLowerCase();
  if (sku) {
    const bySku = catalog.find((p) => String(p.sku || "").toLowerCase() === sku);
    if (bySku) return bySku;
  }
  const name = String(line.name || "").trim().toLowerCase();
  if (!name) return null;
  return (
    catalog.find((p) => p.name.trim().toLowerCase() === name) ||
    catalog.find((p) => p.name.trim().toLowerCase().includes(name)) ||
    null
  );
}

/**
 * Compose catalog prices into writer tokens. Missing price/qty never extrapolates.
 */
export function composePricing(input: {
  lines: PricingPlanLine[];
  catalog: PricingCatalogProduct[];
  addons?: PricingCatalogAddon[];
  currency?: string;
}): ComposedPricing {
  const currency = input.currency || input.catalog[0]?.currency || "USD";
  const issues: PricingIssue[] = [];
  const lines: ComposedPricing["lines"] = [];
  const tokens: Record<string, string> = {};
  let total = 0;
  let totalOk = true;

  input.lines.forEach((line, index) => {
    const token = `price.line.${index + 1}`;
    const qty = Number(line.quantity);
    const product = matchProduct(line, input.catalog);
    if (!product) {
      issues.push({
        code: "unmatched_product",
        message: `No catalog match for "${line.name}".`,
        productName: line.name,
      });
      tokens[`{{${token}}}`] = TBC;
      tokens[`{{${token}.rate}}`] = TBC;
      lines.push(emptyLine(token, line.name, Number.isFinite(qty) ? qty : 0));
      totalOk = false;
      return;
    }
    if (!Number.isFinite(qty) || qty <= 0) {
      issues.push({
        code: "missing_qty",
        message: `Quantity missing for ${product.name}.`,
        productName: product.name,
      });
      tokens[`{{${token}}}`] = TBC;
      tokens[`{{${token}.rate}}`] = TBC;
      lines.push(emptyLine(token, product.name, 0));
      totalOk = false;
      return;
    }

    const addon = (input.addons || []).find(
      (a) => a.id === line.addonId || (a.productId === product.id && line.addonId),
    );
    try {
      let amount: number;
      let unit: number | null = null;
      if (addon) {
        amount = priceAddon(
          {
            pricingModel: addon.pricingModel,
            flatPrice: addon.flatPrice,
            unitPrice: addon.unitPrice,
            stepSize: addon.stepSize,
            stepPrice: addon.stepPrice,
            tiers: addon.tiers,
          },
          qty,
        );
        unit = qty > 0 ? amount / qty : amount;
      } else {
        const listRaw = product.price;
        if (listRaw == null || listRaw === "") {
          throw new Error("missing_price");
        }
        const list = Number(listRaw);
        if (!Number.isFinite(list)) {
          throw new Error("missing_price");
        }
        unit = list;
        amount = list * qty;
      }
      total += amount;
      const unitLabel = rateUnitForLine(product, addon);
      const rateDisplay =
        unit != null
          ? formatCatalogListRate(unit, currency, unitLabel)
          : TBC;
      const display = money(amount, currency);
      tokens[`{{${token}}}`] = display;
      tokens[`{{${token}.rate}}`] = rateDisplay;
      lines.push({
        token,
        productName: product.name,
        quantity: qty,
        unitPrice: unit,
        amount,
        unitLabel,
        rateDisplay,
        display,
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      const code: PricingIssue["code"] = /tier/i.test(msg)
        ? "qty_outside_tiers"
        : "missing_price";
      issues.push({
        code,
        message:
          code === "qty_outside_tiers"
            ? `Quantity ${qty} is outside catalog tiers for ${product.name}.`
            : `No list price for ${product.name}.`,
        productName: product.name,
      });
      tokens[`{{${token}}}`] = TBC;
      tokens[`{{${token}.rate}}`] = TBC;
      lines.push(emptyLine(token, product.name, qty));
      totalOk = false;
    }
  });

  const totalToken = "price.total";
  tokens[`{{${totalToken}}}`] = totalOk ? money(total, currency) : TBC;
  return {
    schemaVersion: 1,
    currency,
    lines,
    total: totalOk ? total : null,
    totalToken,
    tokens,
    issues,
    sendBlocked: issues.length > 0,
  };
}

export function stripCatalogPrices<T extends Record<string, unknown>>(
  products: T[],
): T[] {
  return products.map((row) => {
    const next = { ...row };
    delete next.price;
    delete next.listPrice;
    delete next.unitPrice;
    delete next.amount;
    return next;
  });
}

export function pricingTokensBlock(pricing: ComposedPricing): string {
  const rows = pricing.lines
    .map(
      (line) =>
        `- ${line.productName} x ${line.quantity}: unit {{${line.token}.rate}} (${line.rateDisplay}); line {{${line.token}}} (${line.display})`,
    )
    .join("\n");
  return [
    "PRICING TOKENS (copy these placeholders; do not invent money).",
    "Unit rates must keep the catalog unit (e.g. 1000/agent), never a bare total when the product is per-agent/seat/ticket.",
    rows || "- (none)",
    `Document total: {{${pricing.totalToken}}}`,
  ].join("\n");
}

function tableColumnsFromSpec(spec: unknown): string[] {
  if (!spec || typeof spec !== "object") return [];
  const cols = (spec as { columns?: unknown }).columns;
  if (!Array.isArray(cols)) return [];
  return cols.map((c) => String(c || "").trim()).filter(Boolean);
}

function isPriceColumn(header: string): boolean {
  const h = header.toLowerCase();
  if (!h) return false;
  if (/requested/.test(h) && !/price|rate|cost/.test(h)) return false;
  return /(?:^|\b)(rate|unit price|list price|price|cost|fee|amount|total|mrc|otc|investment)(?:\b|$)/i.test(
    h,
  );
}

function isQtyColumn(header: string): boolean {
  return /qty|quantity|units|agents?|seats?|tickets?/i.test(header);
}

function isNameColumn(header: string): boolean {
  return /product|item|sku|solution|name|description|charge/i.test(header);
}

function looksLikeMoneyCell(value: string): boolean {
  const s = String(value || "").trim();
  if (!s) return false;
  return /(?:usd|eur|gbp|inr|\$|€|£)\s*[\d,]+|\b\d[\d,]*(?:\.\d+)?\s*\/\s*\w+|\b\d{1,3}(?:,\d{3})+(?:\.\d+)?\b|\b\d+\.\d{2}\b/i.test(
    s,
  );
}

function catalogPricingRows(pricing: ComposedPricing): Array<{ cells: string[] }> {
  return pricing.lines.map((line) => ({
    cells: [
      line.productName,
      String(line.quantity),
      line.rateDisplay,
      line.display,
    ],
  }));
}

function alignLineToColumns(
  columns: string[],
  line: ComposedPricing["lines"][number],
): string[] {
  return columns.map((header, index) => {
    if (isQtyColumn(header)) return String(line.quantity);
    if (isPriceColumn(header)) {
      if (/amount|total|investment/i.test(header)) return line.display;
      return line.rateDisplay;
    }
    if (isNameColumn(header) || index === 0) return line.productName;
    return "";
  });
}

export function catalogRatesCaption(pricing: ComposedPricing): string {
  const bits = pricing.lines.map(
    (line) => `${line.productName}: ${line.rateDisplay}`,
  );
  if (!bits.length) return "";
  return `Catalog rates: ${bits.join("; ")}.`;
}

/**
 * Fill commercials price columns / empty pricing tables from catalog rates
 * (e.g. $1,000/agent). Comparison grids without a price column are left intact.
 */
export function overlayCatalogPricingOnSections<
  T extends {
    key?: string;
    body?: string;
    tableRows?: Array<{ cells: string[] }>;
    tableSpec?: unknown;
  },
>(sections: T[], pricing: ComposedPricing): T[] {
  if (!pricing.lines.length) return sections;
  const caption = catalogRatesCaption(pricing);
  return sections.map((section) => {
    const key = String(section.key || "");
    if (!/pric|commercial|cost|investment|fee/i.test(key)) return section;
    const columns = tableColumnsFromSpec(section.tableSpec);
    const existing = Array.isArray(section.tableRows) ? section.tableRows : [];
    const priceColIndexes = columns
      .map((header, i) => (isPriceColumn(header) ? i : -1))
      .filter((i) => i >= 0);

    let tableRows = existing;
    if (priceColIndexes.length) {
      const used = new Set<string>();
      tableRows = existing.map((row) => {
        const cells = [...(row.cells || [])];
        const label = String(cells[0] || "").trim().toLowerCase();
        const match = pricing.lines.find(
          (line) =>
            line.productName.trim().toLowerCase() === label ||
            label.includes(line.productName.trim().toLowerCase()) ||
            line.productName.trim().toLowerCase().includes(label),
        );
        if (!match) return row;
        used.add(match.token);
        for (const i of priceColIndexes) {
          cells[i] = /amount|total|investment/i.test(columns[i] || "")
            ? match.display
            : match.rateDisplay;
        }
        return { cells };
      });
      for (const line of pricing.lines) {
        if (used.has(line.token)) continue;
        tableRows = [...tableRows, { cells: alignLineToColumns(columns, line) }];
      }
    } else {
      const hasContent = existing.some((row) =>
        (row.cells || []).some((c) => String(c || "").trim()),
      );
      if (!hasContent) {
        tableRows = catalogPricingRows(pricing);
      } else {
        tableRows = existing.map((row) => {
          const cells = [...(row.cells || [])];
          const label = String(cells[0] || "").trim().toLowerCase();
          const match = pricing.lines.find(
            (line) =>
              line.productName.trim().toLowerCase() === label ||
              (label.length >= 4 &&
                line.productName.trim().toLowerCase().includes(label)),
          );
          if (!match) return row;
          return {
            cells: cells.map((cell) =>
              looksLikeMoneyCell(cell) ? match.rateDisplay : cell,
            ),
          };
        });
      }
    }

    const body = String(section.body || "");
    const nextBody =
      caption && !body.toLowerCase().includes("catalog rates:")
        ? [body.trim(), caption].filter(Boolean).join("\n\n")
        : body;

    return { ...section, tableRows, body: nextBody };
  });
}
