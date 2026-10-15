/**
 * Currency for prices and deal amounts.
 * A stored code wins. A missing code follows the tenant country.
 * USD is used only when the country is unknown.
 */

import { loadSellerOrganization } from "@/service/ai/seller-org";

export function currencyFromCountry(
  country: string | null | undefined,
): string | null {
  const raw = (country ?? "").trim().toLowerCase();
  if (!raw) return null;
  if (raw === "in" || raw === "ind" || raw === "india" || raw.includes("india")) {
    return "INR";
  }
  if (
    raw === "uk" ||
    raw === "gb" ||
    raw === "gbr" ||
    raw.includes("united kingdom") ||
    raw.includes("great britain") ||
    raw === "england"
  ) {
    return "GBP";
  }
  if (
    raw === "us" ||
    raw === "usa" ||
    raw.includes("united states") ||
    raw === "america"
  ) {
    return "USD";
  }
  if (raw === "ae" || raw === "uae" || raw.includes("arab emirates")) {
    return "AED";
  }
  if (raw === "eu" || raw.includes("euro")) return "EUR";
  return null;
}

export async function resolveTenantCurrency(
  organizationId: string,
): Promise<string | null> {
  const id = organizationId.trim();
  if (!id) return null;
  const org = await loadSellerOrganization(id);
  return currencyFromCountry(org?.country ?? null);
}

/** Tenant country currency, or USD when the country is unknown. */
export async function resolveDashboardCurrency(
  organizationId: string,
): Promise<string> {
  return (await resolveTenantCurrency(organizationId)) ?? "USD";
}

export function formatDashboardMoney(n: number, currency: string): string {
  const code = currency.trim().toUpperCase() || "USD";
  try {
    return new Intl.NumberFormat(undefined, {
      style: "currency",
      currency: code,
      maximumFractionDigits: 0,
    }).format(n);
  } catch {
    return `${code} ${Math.round(n).toLocaleString()}`;
  }
}

/** Blank input becomes the tenant currency, then USD if the country is unknown. */
export async function resolveWrittenCurrency(
  explicit: string | null | undefined,
  organizationId: string,
): Promise<string> {
  const chosen = explicit?.trim().toUpperCase();
  if (chosen) return chosen;
  return (await resolveTenantCurrency(organizationId)) ?? "USD";
}

/**
 * Label for deals.amount, which has no currency column.
 * A quote currency other than the old USD default is kept.
 * USD on the quote is treated as that default when the tenant is not in the US.
 */
export function chooseDealAmountCurrency(input: {
  quoteCurrency: string | null;
  tenantCurrency: string | null;
}): string | null {
  const quote = input.quoteCurrency?.trim().toUpperCase() || null;
  const tenant = input.tenantCurrency?.trim().toUpperCase() || null;
  if (quote && !(quote === "USD" && tenant && tenant !== "USD")) return quote;
  return tenant ?? quote;
}

export function preferredQuoteCurrency(
  quotes: Array<{
    dealId: string;
    currency: string | null;
    status: string;
    updatedAt: Date;
  }>,
): Map<string, string> {
  const byDeal = new Map<
    string,
    { currency: string; accepted: boolean; updatedAt: number }
  >();
  for (const quote of quotes) {
    const currency = quote.currency?.trim().toUpperCase();
    if (!currency) continue;
    const accepted = quote.status === "accepted";
    const updatedAt = quote.updatedAt.getTime();
    const prev = byDeal.get(quote.dealId);
    if (
      !prev ||
      (accepted && !prev.accepted) ||
      (accepted === prev.accepted && updatedAt > prev.updatedAt)
    ) {
      byDeal.set(quote.dealId, { currency, accepted, updatedAt });
    }
  }
  return new Map([...byDeal].map(([id, row]) => [id, row.currency]));
}

/** First shared product currency on quote lines, in line order. */
export function currencyFromProductCodes(
  codes: Array<string | null | undefined>,
): string | null {
  const ordered = codes
    .map((code) => code?.trim().toUpperCase() || "")
    .filter(Boolean);
  if (ordered.length === 0) return null;
  const unique = new Set(ordered);
  if (unique.size === 1) return ordered[0]!;
  return ordered[0]!;
}
