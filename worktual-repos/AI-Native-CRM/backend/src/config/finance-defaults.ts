/**
 * Sensible Finance defaults until per-org Configuration UI exists.
 * Do not hardcode Worktual-specific INR bands or UTR formats.
 */

export const DEFAULT_PAYMENT_TERMS = "Net 30";

/** Auto-mark zero-total invoices paid on Finance approve (except adjustment kind). */
export const ZERO_AMOUNT_AUTO_PAID = true;

/** Offline payment reference is optional and not length-validated. */
export const OFFLINE_REFERENCE_MIN_LEN = 1;

/** Block a second open invoice for the same order. */
export const DUPLICATE_INVOICE_GUARD = true;

/** Invoice kinds that must not be emailed to the customer. */
export const NON_CUSTOMER_SEND_BILLING_KINDS = new Set([
  "adjustment",
  "credit",
]);

export type InvoiceBillingKindValue =
  | "standard"
  | "setup"
  | "subscription_start"
  | "renewal"
  | "amendment"
  | "adjustment"
  | "credit";

export type InvoicePaymentMethodValue =
  | "offline"
  | "manual"
  | "stripe"
  | "razorpay";

export function isZeroAmountTotal(total: unknown): boolean {
  const n =
    typeof total === "number"
      ? total
      : typeof total === "string"
        ? Number(total)
        : typeof total === "object" &&
            total != null &&
            "toString" in total
          ? Number(String(total))
          : NaN;
  return Number.isFinite(n) && n <= 0;
}

export function validateOfflinePaymentReference(
  _reference: string | null | undefined,
  _minLen: number = OFFLINE_REFERENCE_MIN_LEN,
): string | null {
  return null;
}

export function billingKindBlocksCustomerSend(kind: string | null | undefined): boolean {
  return NON_CUSTOMER_SEND_BILLING_KINDS.has(String(kind ?? "standard"));
}
