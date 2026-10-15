import type { InvoiceStatus } from "@prisma/client";

export const INVOICE_STATUS_LABELS: Record<InvoiceStatus, string> = {
  draft: "Draft",
  sent: "Sent",
  paid: "Paid",
  void: "Void",
  overdue: "Overdue",
};

export type InvoiceStatusFilter =
  | "all"
  | "draft"
  | "sent"
  | "paid"
  | "void"
  | "overdue";

/** Effective status for UI: unpaid past due → overdue even if DB says sent. */
export function effectiveInvoiceStatus(
  status: InvoiceStatus,
  dueAt: Date | string | null | undefined,
  now = new Date(),
): InvoiceStatus {
  if (status === "paid" || status === "void" || status === "draft") {
    return status;
  }
  if (status === "overdue") return "overdue";
  if (dueAt) {
    const due = typeof dueAt === "string" ? new Date(dueAt) : dueAt;
    if (!Number.isNaN(due.getTime()) && due.getTime() < now.getTime()) {
      return "overdue";
    }
  }
  return status;
}

export function invoiceStatusPillClass(status: InvoiceStatus): string {
  switch (status) {
    case "paid":
      return "bg-emerald-50 text-emerald-800";
    case "overdue":
      return "bg-red-50 text-red-800";
    case "void":
      return "bg-neutral-100 text-text-caption";
    case "draft":
      return "bg-amber-50 text-amber-900";
    default:
      return "bg-sky-50 text-sky-900";
  }
}

export function formatInvoiceMoney(
  total: string | number | null | undefined,
  currency: string,
): string {
  const n =
    typeof total === "number"
      ? total
      : total != null
        ? Number.parseFloat(String(total))
        : NaN;
  if (!Number.isFinite(n)) return "—";
  try {
    return new Intl.NumberFormat(undefined, {
      style: "currency",
      currency: currency || "USD",
      maximumFractionDigits: 2,
    }).format(n);
  } catch {
    return `${currency} ${n.toLocaleString()}`;
  }
}

export const INVOICE_BILLING_KIND_LABELS: Record<string, string> = {
  standard: "Standard",
  setup: "Setup fee",
  subscription_start: "Subscription start",
  renewal: "Renewal",
  amendment: "Amendment",
  adjustment: "Adjustment",
  credit: "Credit",
};

export function invoiceBillingKindLabel(kind: string | null | undefined): string {
  return INVOICE_BILLING_KIND_LABELS[kind ?? "standard"] ?? "Standard";
}
