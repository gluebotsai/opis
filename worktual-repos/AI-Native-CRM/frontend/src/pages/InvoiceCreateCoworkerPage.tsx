import { InvoiceCreatePage } from "./InvoiceCreatePage";

/**
 * Invoice create is a single form (deal, terms, products, tax, billing).
 * Kept as a thin route wrapper so /finance/new stays stable for deep links.
 */
export function InvoiceCreateCoworkerPage() {
  return <InvoiceCreatePage />;
}
