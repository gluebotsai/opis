import { prisma } from "@/dao/db/prisma";
import {
  chooseDealAmountCurrency,
  preferredQuoteCurrency,
  resolveTenantCurrency,
} from "@/lib/commercial-currency";

/** Currency label for each deal amount. Null means show the number with no symbol. */
export async function loadDealAmountCurrencies(
  organizationId: string,
  dealIds: string[],
): Promise<Map<string, string | null>> {
  const tenant = await resolveTenantCurrency(organizationId);
  const map = new Map<string, string | null>();
  if (dealIds.length === 0) return map;

  const quotes = await prisma.quote.findMany({
    where: { organizationId, dealId: { in: dealIds } },
    select: { dealId: true, currency: true, status: true, updatedAt: true },
  });
  const byQuote = preferredQuoteCurrency(quotes);
  for (const id of dealIds) {
    map.set(
      id,
      chooseDealAmountCurrency({
        quoteCurrency: byQuote.get(id) ?? null,
        tenantCurrency: tenant,
      }),
    );
  }
  return map;
}
