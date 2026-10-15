/**
 * Customer-360 cache revalidation was Next.js App Router–specific.
 * SPA clients refetch; this is a no-op kept for call-site compatibility.
 */
export async function revalidateCustomer360(_input?: {
  contactIds?: Array<string | null | undefined>;
  companyIds?: Array<string | null | undefined>;
  locationIds?: Array<string | null | undefined>;
  dealIds?: Array<string | null | undefined>;
  invoiceIds?: Array<string | null | undefined>;
}): Promise<void> {
  /* no-op after Vite cutover */
}
