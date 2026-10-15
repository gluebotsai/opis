import {
  CHIP_BASE,
  TONE_DANGER,
  TONE_INFO,
  TONE_NEUTRAL,
  TONE_SUCCESS,
  TONE_WARNING,
} from "@/lib/ui-tones";

export const INVOICE_STATUS_LABELS: Record<string, string> = {
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
  status: string,
  dueAt: Date | string | null | undefined,
  now = new Date(),
): string {
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

export function invoiceStatusPillClass(status: string): string {
  switch (status) {
    case "paid":
      return `${CHIP_BASE} ${TONE_SUCCESS}`;
    case "overdue":
      return `${CHIP_BASE} ${TONE_DANGER}`;
    case "void":
      return `${CHIP_BASE} ${TONE_NEUTRAL}`;
    case "draft":
      return `${CHIP_BASE} ${TONE_WARNING}`;
    default:
      return `${CHIP_BASE} ${TONE_INFO}`;
  }
}

export const ESCALATION_SEVERITY_LABELS: Record<string, string> = {
  watch: "Watch",
  escalate: "Escalate",
  urgent: "Urgent",
};

/** Invoice Escalation Agent — collections-risk badge (informational only). */
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

export function escalationSeverityPillClass(severity: string): string {
  switch (severity) {
    case "urgent":
      return `${CHIP_BASE} ${TONE_DANGER}`;
    case "escalate":
      return `${CHIP_BASE} ${TONE_WARNING}`;
    case "watch":
      return `${CHIP_BASE} ${TONE_INFO}`;
    default:
      return `${CHIP_BASE} ${TONE_NEUTRAL}`;
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
