import { useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { FinanceShell } from "@/components/finance/FinanceShell";
import {
  DocumentBlueprintView,
  formatCompanyDisplayName,
} from "@/components/documents/DocumentBlueprintView";
import { RichStructuredContent } from "@/components/content/RichStructuredContent";
import { Button } from "@/components/ui/Button";
import { BackLink } from "@/components/ui/BackLink";
import { DropdownSelect } from "@/components/ui/DropdownSelect";
import { ConfirmDeleteButton } from "@/components/ui/ConfirmDeleteButton";
import {
  effectiveInvoiceStatus,
  ESCALATION_SEVERITY_LABELS,
  escalationSeverityPillClass,
  formatInvoiceMoney,
  INVOICE_STATUS_LABELS,
  invoiceBillingKindLabel,
  invoiceStatusPillClass,
} from "@/lib/invoice-labels";
import { canEditDeals, canEditFinance, normalizeRole } from "@/lib/rbac";
import {
  deleteInvoice,
  downloadInvoicePdf,
  fetchInvoice,
  fetchInvoiceBar,
  fetchInvoiceCreateOptions,
  approveInvoice,
  rejectInvoiceApproval,
  invoiceBlocksCustomerSend,
  invoiceIsApproved,
  markInvoicePaid,
  resendInvoice,
  resubmitInvoice,
  sendInvoiceEmail,
  updateInvoice,
  voidInvoice,
  withdrawInvoiceApproval,
  type InvoiceBarItem,
  type InvoiceDetail,
  type InvoiceDocumentSection,
  type InvoiceProductOption,
} from "@/services/finance";
import type { AgentToolProposal } from "@/services/coworker";
import { useAppSelector } from "@/store";
import { FinanceInvoiceDetailSkeleton } from "./FinancePageSkeleton";
import { AgentModuleShell } from "@/components/coworker/AgentModuleShell";

function roundMoney(n: number) {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

function toolNumber(value: unknown, fallback: number) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function matchInvoiceProduct(
  products: InvoiceProductOption[],
  productId: string,
  name: string,
) {
  const id = productId.trim();
  if (id) {
    const byId = products.find((p) => p.id === id);
    if (byId) return byId;
  }
  const nm = name.trim().toLowerCase();
  if (!nm) return null;
  const exact = products.find((p) => p.name.toLowerCase() === nm);
  if (exact) return exact;
  const contained = products.filter(
    (p) =>
      p.name.toLowerCase().includes(nm) || nm.includes(p.name.toLowerCase()),
  );
  return contained.length === 1 ? contained[0]! : null;
}

async function resolveInvoiceLinesFromTool(raw: unknown): Promise<
  | Array<{
      productId?: string | null;
      name: string;
      quantity: number;
      unitPrice: number;
    }>
  | null
> {
  if (!Array.isArray(raw) || raw.length === 0) return null;
  const options = await fetchInvoiceCreateOptions().catch(() => null);
  const products = options?.products ?? [];
  const out: Array<{
    productId?: string | null;
    name: string;
    quantity: number;
    unitPrice: number;
  }> = [];
  for (const row of raw) {
    if (!row || typeof row !== "object") continue;
    const rec = row as Record<string, unknown>;
    const productId = String(rec.productId || rec.product || "").trim();
    const nameRaw = String(rec.name || "").trim();
    const product = matchInvoiceProduct(products, productId, nameRaw);
    const name = (product?.name || nameRaw).trim();
    if (!name) continue;
    out.push({
      productId: product?.id ?? (productId || null),
      name,
      quantity: Math.max(0.01, toolNumber(rec.quantity, 1)),
      unitPrice: Math.max(
        0,
        toolNumber(rec.unitPrice, product?.price ? Number(product.price) : 0),
      ),
    });
  }
  return out.length ? out : null;
}

function lineAmountWithTax(amount: string, taxPercent: string) {
  const base = Number(amount) || 0;
  const pct = Number(taxPercent) || 0;
  return roundMoney(base + base * (pct / 100));
}

function formatDate(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

function cell(value: string | number): string {
  return String(value ?? "")
    .replace(/\|/g, "/")
    .replace(/\n+/g, " ")
    .trim();
}

function sectionsWithLineItems(
  sections: InvoiceDocumentSection[],
  invoice: InvoiceDetail,
): InvoiceDocumentSection[] {
  const commercial = Boolean(
    invoice.blueprint &&
      (/bp-inv-banner|bp-page-clone/i.test(invoice.blueprint.html || "") ||
        invoice.blueprint.mode === "page-clone" ||
        invoice.blueprint.chrome === false),
  );

  // Backend already prepared commercial sections (WIPL columns + financial summary).
  if (commercial) {
    return sections
      .filter((s) => {
        const key = (s.key || "").toLowerCase();
        // Drop empty introduction — letterhead is in the black banner.
        if (key === "introduction" && !(s.body || "").trim()) return false;
        return true;
      })
      .map((s) => {
        const key = (s.key || "").toLowerCase();
        if (key === "introduction") return { ...s, body: "" };
        return s;
      });
  }

  const header =
    "| Item | Qty | Unit | Tax % | Amount (incl. tax) |\n| --- | --- | --- | --- | --- |";
  const rows = invoice.lines.map((line) => {
    const label = line.description?.trim()
      ? `${cell(line.name)} — ${cell(line.description)}`
      : cell(line.name);
    const incl = lineAmountWithTax(line.amount, line.taxPercent);
    return `| ${label} | ${cell(line.quantity)} | ${cell(formatInvoiceMoney(line.unitPrice, invoice.currency))} | ${cell(line.taxPercent)} | ${cell(formatInvoiceMoney(String(incl), invoice.currency))} |`;
  });
  const subtotal = invoice.lines.reduce(
    (sum, line) => sum + Number(line.amount),
    0,
  );
  const totalsParts: string[] = [
    `Subtotal (excl. tax): ${formatInvoiceMoney(String(subtotal), invoice.currency)}`,
  ];
  if (Number(invoice.discountAmount) > 0) {
    totalsParts.push(
      `Discount: −${formatInvoiceMoney(invoice.discountAmount, invoice.currency)}`,
    );
  }
  if (invoice.taxDetails?.components?.length) {
    for (const c of invoice.taxDetails.components) {
      totalsParts.push(
        `${c.label} (${c.percent}%): ${formatInvoiceMoney(String(c.amount), invoice.currency)}`,
      );
    }
  } else if (Number(invoice.taxAmount) > 0) {
    totalsParts.push(
      `Tax: ${formatInvoiceMoney(invoice.taxAmount, invoice.currency)}`,
    );
  }
  if (invoice.taxDetails?.summaryLines?.length) {
    totalsParts.push("");
    for (const line of invoice.taxDetails.summaryLines) {
      totalsParts.push(`_${cell(line)}_`);
    }
  }
  totalsParts.push("");
  totalsParts.push(
    `**Amount due: ${formatInvoiceMoney(invoice.total, invoice.currency)}**`,
  );
  const totals = totalsParts.join("\n");
  const body = `${invoice.lines.length ? [header, ...rows].join("\n") : "_No line items._"}\n\n${totals}`;

  const filtered = sections.filter((s) => {
    const key = (s.key || "").toLowerCase().trim();
    const title = (s.title || "").toLowerCase().trim();
    if (
      key === "tax" ||
      key === "tax_summary" ||
      key === "totals" ||
      key === "summary"
    ) {
      return false;
    }
    if (/^(tax(\s*summary)?|totals?|amount\s+due)$/.test(title)) {
      return false;
    }
    return true;
  }).map((s) => {
    const key = (s.key || "").toLowerCase();
    const body = s.body || "";
    const lines = body.split("\n").filter(Boolean).length;
    const looksLikeThinLetterhead =
      (key === "introduction" || /^invoice$/i.test(s.title || "")) &&
      /invoice\s*#|bill\s*to/i.test(body) &&
      /<img\b|asset:logo/i.test(body) &&
      lines > 0 &&
      lines <= 8 &&
      !/gst\s*:|hsn|ifsc|account\s+number|financial\s+summary/i.test(body);
    if (looksLikeThinLetterhead) {
      return { ...s, body: "" };
    }
    return s;
  });

  const existing = filtered.findIndex(
    (s) => (s.key || "").toLowerCase() === "line_items",
  );
  if (existing >= 0) {
    return filtered.map((s, i) =>
      i === existing ? { ...s, title: s.title || "Line items", body } : s,
    );
  }
  const introIdx = filtered.findIndex(
    (s) => (s.key || "").toLowerCase() === "introduction",
  );
  const insertAt = introIdx >= 0 ? introIdx + 1 : 0;
  const next = filtered.slice();
  next.splice(insertAt, 0, {
    id: "sec-line-items",
    key: "line_items",
    title: "Line items",
    body,
    sortOrder: insertAt + 1,
  });
  return next.map((s, i) => ({ ...s, sortOrder: i + 1 }));
}

export function InvoiceDetailPage() {
  const { invoiceId } = useParams<{ invoiceId: string }>();
  const navigate = useNavigate();
  const user = useAppSelector((s) => s.auth.user);
  const role = normalizeRole(user?.role);
  const canEdit = canEditFinance(role);
  const canResubmit = canEdit || canEditDeals(role);
  const [invoice, setInvoice] = useState<InvoiceDetail | null>(null);
  const [bar, setBar] = useState<InvoiceBarItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [rejectOpen, setRejectOpen] = useState(false);
  const [rejectReason, setRejectReason] = useState("");
  const [payOpen, setPayOpen] = useState(false);
  const [payReference, setPayReference] = useState("");
  const [payMethod, setPayMethod] = useState<"offline" | "manual">("offline");
  const [voidOpen, setVoidOpen] = useState(false);
  const [voidReason, setVoidReason] = useState("");
  const [sendProvider, setSendProvider] = useState<"stripe" | "razorpay">("stripe");

  const reload = async () => {
    if (!invoiceId) return;
    setLoading(true);
    setError(null);
    try {
      const [detail, barResult] = await Promise.all([
        fetchInvoice(invoiceId),
        fetchInvoiceBar(),
      ]);
      setBar(barResult.items);
      if (!detail.ok) {
        setInvoice(null);
        setError(detail.error);
        return;
      }
      setInvoice(detail.invoice);
    } catch {
      setError("Failed to load invoice.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [invoiceId]);

  useEffect(() => {
    const preferred = invoice?.allowedPaymentProviders?.[0];
    if (preferred) setSendProvider(preferred);
  }, [invoice?.allowedPaymentProviders]);

  if (loading) {
    return (
      <AgentModuleShell
        moduleId="finance"
        title="Invoice"
        welcome="I'm your **finance agent**. Ask me about this invoice while the record loads on the right."
        surface="detail"
        entityId={invoiceId ?? null}
        workspace={<FinanceInvoiceDetailSkeleton />}
      />
    );
  }

  if (!invoice) {
    return (
      <AgentModuleShell
        moduleId="finance"
        title="Invoice"
        welcome="I'm your **finance agent**. Ask me about invoices while you use the workspace on the right."
        surface="detail"
        entityId={invoiceId ?? null}
        workspace={
          <div className="px-6 py-10">
            <p className="text-sm text-text-danger">{error ?? "Not found"}</p>
            <BackLink to="/finance" className="mt-3">
              Back to Finance
            </BackLink>
          </div>
        }
      />
    );
  }

  const displayStatus = effectiveInvoiceStatus(invoice.status, invoice.dueAt);
  const isDraft = invoice.status === "draft";
  const isApproved = invoiceIsApproved(invoice);
  const pendingApproval = invoice.approvalStatus === "pending_approval";
  const financeRejected = invoice.approvalStatus === "finance_rejected";
  const blocksCustomerSend = invoiceBlocksCustomerSend(invoice);
  const isZeroAmount = Number(invoice.total) <= 0;
  const isSent =
    invoice.status === "sent" ||
    (invoice.status !== "paid" &&
      invoice.status !== "void" &&
      displayStatus === "overdue");
  const isLocked =
    invoice.status === "paid" || invoice.status === "void";
  const canMutateInvoice = canEdit && !isLocked;
  const editBlockedReason = !canEdit
    ? "Only Finance (or Admin) can edit invoices. Sales roles can view invoices linked from deals and quotes."
    : invoice.status === "paid"
      ? "This invoice is paid — line items and totals are locked."
      : invoice.status === "void"
        ? "This invoice is void and cannot be edited."
        : null;
  const subtotal = invoice.lines.reduce(
    (sum, line) => sum + Number(line.amount),
    0,
  );

  const onPaid = async () => {
    setPayOpen(true);
    setPayReference("");
    setPayMethod("offline");
  };

  const confirmMarkPaid = async () => {
    setBusy(true);
    setError(null);
    setMessage(null);
    const result = await markInvoicePaid(invoice.id, {
      paymentReference: payReference.trim() || undefined,
      paymentMethod: payMethod,
    });
    setBusy(false);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    setPayOpen(false);
    setMessage("Invoice marked paid.");
    await reload();
  };

  const onApprove = async () => {
    setBusy(true);
    setError(null);
    setMessage(null);
    const result = await approveInvoice(invoice.id);
    setBusy(false);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    setMessage("Invoice approved — you can send it to the customer.");
    await reload();
  };

  const onSend = async () => {
    setBusy(true);
    setError(null);
    setMessage(null);
    const result = await sendInvoiceEmail(invoice.id, {
      paymentProvider:
        invoice.paymentPathMode === "online" ? sendProvider : undefined,
    });
    setBusy(false);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    setMessage("Invoice emailed to the customer.");
    await reload();
  };

  const workspace = (
    <FinanceShell invoices={bar} showNew={canEdit}>
      <div className="crm-fade-in">
        <div className="mb-5 flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="text-xl font-semibold tracking-tight text-text-primary">
                {invoice.number}
              </h2>
              <span className={invoiceStatusPillClass(displayStatus)}>
                {INVOICE_STATUS_LABELS[displayStatus] ?? displayStatus}
              </span>
              {invoice.billingKind && invoice.billingKind !== "standard" ? (
                <span className="rounded-full bg-subtle px-2 py-0.5 text-xs text-text-secondary">
                  {invoiceBillingKindLabel(invoice.billingKind)}
                </span>
              ) : null}
              {invoice.contractId ? (
                <span className="rounded-full bg-subtle px-2 py-0.5 text-xs text-text-secondary">
                  Contract linked
                </span>
              ) : null}
              {invoice.escalationSeverity ? (
                <span
                  className={escalationSeverityPillClass(
                    invoice.escalationSeverity,
                  )}
                  title="Invoice Escalation Agent's collections-risk assessment"
                >
                  {ESCALATION_SEVERITY_LABELS[invoice.escalationSeverity] ??
                    invoice.escalationSeverity}
                </span>
              ) : null}
            </div>
            <p className="mt-1 text-sm text-text-caption">
              {invoice.dealId && invoice.dealTitle ? (
                <>
                  Linked to deal{" "}
                  <Link
                    to={`/sales/${invoice.dealId}`}
                    className="font-medium text-brand underline"
                  >
                    {invoice.dealTitle}
                  </Link>
                  {invoice.companyId ? (
                    <>
                      {" · "}
                      <Link
                        to={`/company/${invoice.companyId}`}
                        className="font-medium text-brand underline"
                      >
                        {formatCompanyDisplayName(invoice.companyName)}
                      </Link>
                    </>
                  ) : null}
                  .
                </>
              ) : (
                "Invoice document preview."
              )}
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              variant="secondary"
              className="h-9"
              disabled={busy}
              onClick={() =>
                void (async () => {
                  setBusy(true);
                  setError(null);
                  try {
                    const blob = await downloadInvoicePdf(invoice.id);
                    const url = URL.createObjectURL(blob);
                    const a = document.createElement("a");
                    a.href = url;
                    a.download = `${invoice.number || "invoice"}.pdf`;
                    a.click();
                    URL.revokeObjectURL(url);
                  } catch (err) {
                    setError(
                      err instanceof Error
                        ? err.message
                        : "Could not download PDF. Ask an admin to install Playwright Chromium on the API.",
                    );
                  } finally {
                    setBusy(false);
                  }
                })()
              }
            >
            Download PDF
          </Button>
            {canEdit && isDraft && !isApproved && !financeRejected ? (
              <>
                <Button
                  type="button"
                  variant="primary"
                  className="h-9"
                  disabled={busy}
                  onClick={() => void onApprove()}
                >
                  Approve
                </Button>
                {pendingApproval ? (
                  <Button
                    type="button"
                    variant="secondary"
                    className="h-9"
                    disabled={busy}
                    onClick={() => {
                      setRejectOpen((v) => !v);
                      setRejectReason("");
                    }}
                  >
                    Reject
                  </Button>
                ) : null}
              </>
            ) : null}
            {canResubmit && financeRejected && isDraft ? (
              <Button
                type="button"
                variant="primary"
                className="h-9"
                disabled={busy}
                onClick={() =>
                  void (async () => {
                    setBusy(true);
                    setError(null);
                    const result = await resubmitInvoice(invoice.id);
                    setBusy(false);
                    if (!result.ok) {
                      setError(result.error);
                      return;
                    }
                    setMessage("Invoice re-submitted for Finance approval.");
                    await reload();
                  })()
                }
              >
                Re-submit for approval
              </Button>
            ) : null}
            {canEdit && isDraft && isApproved && !blocksCustomerSend ? (
              <>
                {invoice.paymentPathMode === "online" &&
                (invoice.allowedPaymentProviders?.length ?? 0) > 1 ? (
                  <DropdownSelect
                    value={sendProvider}
                    options={(invoice.allowedPaymentProviders ?? ["stripe"]).map(
                      (provider) => ({
                        value: provider,
                        label: provider === "stripe" ? "Stripe" : "Razorpay",
                      }),
                    )}
                    disabled={busy}
                    onChange={(value) =>
                      setSendProvider(value as "stripe" | "razorpay")
                    }
                    aria-label="Payment provider"
                  />
                ) : null}
                <Button
                  type="button"
                  variant="secondary"
                  className="h-9"
                  disabled={busy}
                  onClick={() => void onSend()}
                >
                  {busy ? "Working…" : "Send to customer"}
                </Button>
                <Button
                  type="button"
                  variant="secondary"
                  className="h-9"
                  disabled={busy}
                  onClick={() =>
                    void (async () => {
                      setBusy(true);
                      setError(null);
                      const result = await withdrawInvoiceApproval(invoice.id);
                      setBusy(false);
                      if (!result.ok) {
                        setError(result.error);
                        return;
                      }
                      setMessage("Approval withdrawn — invoice returned to Finance queue.");
                      await reload();
                    })()
                  }
                >
                  Withdraw approval
                </Button>
              </>
            ) : null}
            {canEdit && isSent && !blocksCustomerSend ? (
              <Button
                type="button"
                variant="secondary"
                className="h-9"
                disabled={busy}
                onClick={() =>
                  void (async () => {
                    setBusy(true);
                    setError(null);
                    const result = await resendInvoice(invoice.id, {
                      paymentProvider:
                        invoice.paymentPathMode === "online"
                          ? sendProvider
                          : undefined,
                    });
                    setBusy(false);
                    if (!result.ok) {
                      setError(result.error);
                      return;
                    }
                    setMessage("Payment reminder sent to the customer.");
                  })()
                }
              >
                Resend reminder
              </Button>
            ) : null}
            {canEdit && isSent ? (
              <Button
                type="button"
                variant="primary"
                className="h-9"
                disabled={busy}
                onClick={() => void onPaid()}
              >
                Mark paid
              </Button>
            ) : null}
            {canEdit && !isLocked ? (
              <Button
                type="button"
                variant="secondary"
                className="h-9"
                disabled={busy}
                onClick={() => {
                  setVoidOpen(true);
                  setVoidReason("");
                }}
              >
                Void
              </Button>
            ) : null}
            {canEdit && isDraft ? (
              <ConfirmDeleteButton
                name={invoice.number}
                entityLabel="invoice"
                consequence="Line items are removed with it. This cannot be undone."
                disabled={busy}
                onConfirm={async () => {
                  const result = await deleteInvoice(invoice.id);
                  if (!result.ok) {
                    return {
                      ok: false,
                      error: result.error ?? "Failed to delete invoice.",
                    };
                  }
                  return { ok: true };
                }}
                onSuccess={() => navigate("/finance")}
              />
            ) : null}
          </div>
        </div>

        {error ? (
          <p className="mb-4 text-sm text-text-danger" role="alert">
            {error}
          </p>
        ) : null}
        {message ? (
          <p className="mb-4 text-sm text-text-secondary">{message}</p>
        ) : null}

        {invoice.paymentPathMode ? (
          <div className="mb-4 rounded-lg border border-border-default bg-subtle px-4 py-3 text-sm print:hidden">
            <p className="font-medium text-text-primary">
              Payment path:{" "}
              {invoice.paymentPathMode === "online"
                ? "Online (payment link)"
                : invoice.paymentPathMode === "offline"
                  ? "Offline bank transfer"
                  : "Blocked"}
            </p>
            {invoice.paymentPathReason ? (
              <p className="mt-1 text-text-caption">{invoice.paymentPathReason}</p>
            ) : null}
            {invoice.paymentLinkUrl ? (
              <div className="mt-2 flex flex-wrap items-center gap-2">
                <code className="max-w-full truncate text-xs text-text-secondary">
                  {invoice.paymentLinkUrl}
                </code>
                <Button
                  type="button"
                  variant="secondary"
                  className="h-8 px-2 text-xs"
                  onClick={() => {
                    void navigator.clipboard.writeText(invoice.paymentLinkUrl!);
                    setMessage("Payment link copied.");
                  }}
                >
                  Copy link
                </Button>
              </div>
            ) : null}
          </div>
        ) : null}

        {rejectOpen && isDraft && pendingApproval ? (
          <div className="mb-4 rounded-lg border border-border-default bg-subtle p-4 print:hidden">
            <label className="block text-sm font-medium text-text-primary">
              Rejection reason
              <textarea
                className="mt-1.5 w-full rounded-md border border-border-default bg-surface px-3 py-2 text-sm"
                rows={3}
                value={rejectReason}
                onChange={(e) => setRejectReason(e.target.value)}
                placeholder="Why is this invoice being rejected?"
              />
            </label>
            <div className="mt-3 flex flex-wrap gap-2">
              <Button
                type="button"
                variant="primary"
                className="h-9"
                disabled={busy || !rejectReason.trim()}
                onClick={() =>
                  void (async () => {
                    setBusy(true);
                    setError(null);
                    setMessage(null);
                    const result = await rejectInvoiceApproval(
                      invoice.id,
                      rejectReason,
                    );
                    setBusy(false);
                    if (!result.ok) {
                      setError(result.error);
                      return;
                    }
                    setRejectOpen(false);
                    setRejectReason("");
                    setMessage("Invoice rejected.");
                    await reload();
                  })()
                }
              >
                Confirm reject
              </Button>
              <Button
                type="button"
                variant="secondary"
                className="h-9"
                disabled={busy}
                onClick={() => {
                  setRejectOpen(false);
                  setRejectReason("");
                }}
              >
                Cancel
              </Button>
            </div>
          </div>
        ) : null}

        {payOpen ? (
          <div className="mb-4 rounded-lg border border-border-default bg-subtle p-4 print:hidden">
            <p className="text-sm font-medium text-text-primary">
              Confirm offline payment
            </p>
            <label className="mt-3 block text-sm text-text-secondary">
              Payment reference (wire ref / UTR / cheque no.)
              <input
                className="mt-1.5 w-full rounded-md border border-border-default bg-surface px-3 py-2 text-sm"
                value={payReference}
                onChange={(e) => setPayReference(e.target.value)}
                placeholder="Optional but recommended"
              />
            </label>
            <label className="mt-3 block text-sm text-text-secondary">
              Method
              <DropdownSelect
                className="mt-1.5"
                value={payMethod}
                options={[
                  { value: "offline", label: "Offline bank transfer" },
                  { value: "manual", label: "Manual / other" },
                ]}
                fullWidth
                size="lg"
                onChange={(value) =>
                  setPayMethod(value as "offline" | "manual")
                }
                aria-label="Payment method"
              />
            </label>
            <div className="mt-3 flex flex-wrap gap-2">
              <Button
                type="button"
                variant="primary"
                className="h-9"
                disabled={busy}
                onClick={() => void confirmMarkPaid()}
              >
                Confirm paid
              </Button>
              <Button
                type="button"
                variant="secondary"
                className="h-9"
                disabled={busy}
                onClick={() => setPayOpen(false)}
              >
                Cancel
              </Button>
            </div>
          </div>
        ) : null}

        {voidOpen ? (
          <div className="mb-4 rounded-lg border border-border-default bg-subtle p-4 print:hidden">
            <label className="block text-sm font-medium text-text-primary">
              Void reason
              <textarea
                className="mt-1.5 w-full rounded-md border border-border-default bg-surface px-3 py-2 text-sm"
                rows={3}
                value={voidReason}
                onChange={(e) => setVoidReason(e.target.value)}
                placeholder="Why is this invoice being voided?"
              />
            </label>
            <div className="mt-3 flex flex-wrap gap-2">
              <Button
                type="button"
                variant="primary"
                className="h-9"
                disabled={busy || !voidReason.trim()}
                onClick={() =>
                  void (async () => {
                    setBusy(true);
                    setError(null);
                    const result = await voidInvoice(invoice.id, voidReason);
                    setBusy(false);
                    if (!result.ok) {
                      setError(result.error);
                      return;
                    }
                    setVoidOpen(false);
                    setMessage("Invoice voided.");
                    await reload();
                  })()
                }
              >
                Confirm void
              </Button>
              <Button
                type="button"
                variant="secondary"
                className="h-9"
                disabled={busy}
                onClick={() => setVoidOpen(false)}
              >
                Cancel
              </Button>
            </div>
          </div>
        ) : null}

        {editBlockedReason ? (
          <div className="mb-4 rounded-lg border border-border-default bg-subtle px-4 py-3 text-sm text-text-secondary print:hidden">
            {editBlockedReason}
          </div>
        ) : null}

        {financeRejected && invoice.approvalNote ? (
          <div className="mb-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-900 print:hidden">
            <p className="font-medium">Finance rejected this invoice</p>
            <p className="mt-1">{invoice.approvalNote}</p>
          </div>
        ) : null}

        {blocksCustomerSend && isApproved ? (
          <div className="mb-4 rounded-lg border border-border-default bg-subtle px-4 py-3 text-sm text-text-secondary print:hidden">
            This {invoiceBillingKindLabel(invoice.billingKind).toLowerCase()}{" "}
            invoice is for internal billing records only — it is not sent to the
            customer.
          </div>
        ) : null}

        {invoice.status === "paid" && isZeroAmount ? (
          <div className="mb-4 rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-900 print:hidden">
            Zero-amount invoice — auto-marked paid on Finance approval.
          </div>
        ) : null}

        {pendingApproval && isDraft && !isApproved ? (
          <div className="mb-4 rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900 print:hidden">
            Approve this invoice before sending it to the customer. To change line
            items or discount first, ask the finance agent to update the invoice.
          </div>
        ) : null}

        {canMutateInvoice && isDraft ? (
          <div className="mb-4 rounded-lg border border-border-default bg-subtle px-4 py-3 text-sm text-text-secondary print:hidden">
            Draft invoices are edited through the finance agent — ask to update
            line items, notes, payment terms, or discount. There is no separate
            edit form yet (unlike quotes).
          </div>
        ) : null}

        {invoice.escalationSeverity ? (
          <section className="mb-4 rounded-xl border border-border-default bg-surface p-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h3 className="text-sm font-semibold text-text-primary">
                Collections risk
              </h3>
              <span
                className={escalationSeverityPillClass(
                  invoice.escalationSeverity,
                )}
              >
                {ESCALATION_SEVERITY_LABELS[invoice.escalationSeverity] ??
                  invoice.escalationSeverity}
              </span>
            </div>
            {invoice.escalationReason ? (
              <p className="mt-2 text-sm text-text-secondary">
                {invoice.escalationReason}
              </p>
            ) : null}
            {invoice.escalationDraft ? (
              <div className="mt-3 rounded-lg bg-subtle p-3">
                <p className="text-xs font-medium text-text-caption">
                  Reminder draft (copy/send manually, or adapt)
                </p>
                <p className="mt-1 whitespace-pre-wrap text-sm text-text-primary">
                  {invoice.escalationDraft}
                </p>
              </div>
            ) : null}
            {invoice.escalationLastRunAt ? (
              <p className="mt-2 text-xs text-text-caption">
                Assessed {new Date(invoice.escalationLastRunAt).toLocaleString()}
              </p>
            ) : null}
          </section>
        ) : null}

        {invoice.blueprint ? (
          <article
            className={
              invoice.blueprint.html?.includes("bp-inv-banner")
                ? "mt-4 overflow-hidden border border-border-default bg-white"
                : "mt-4 rounded-xl border border-border-default bg-surface p-5 sm:p-8"
            }
          >
            <DocumentBlueprintView
              blueprint={invoice.blueprint}
              assets={invoice.assets}
              sections={
                invoice.blueprint?.mode === "spreadsheet-layout"
                  ? (invoice.sections ?? [])
                  : sectionsWithLineItems(invoice.sections ?? [], invoice)
              }
              tokens={{
                customerName: formatCompanyDisplayName(invoice.companyName),
                companyName: formatCompanyDisplayName(invoice.companyName),
                invoiceNumber: invoice.number,
                date: formatDate(invoice.issueDate ?? invoice.createdAt),
                dueDate: formatDate(invoice.dueAt),
                vendorName: invoice.vendorName || "Our company",
                sellerAddress: invoice.sellerAddress || "",
                sellerLetterhead:
                  invoice.sellerLetterhead || invoice.sellerAddress || "",
                vendorLegalName:
                  invoice.vendorLegalName ||
                  (invoice.vendorName
                    ? "WORKTUAL INNOVATIONS PRIVATE LIMITED"
                    : "Our company"),
                amountInWords: invoice.amountInWords || "",
                currency: invoice.currency,
                subtotal: String(subtotal),
                taxAmount: invoice.taxAmount,
                total: invoice.total,
                paymentTerms: invoice.paymentTerms || "Net 30",
                billingAddress: invoice.billingAddress || "—",
                taxId: invoice.taxId || "—",
                dealTitle: invoice.dealTitle || "",
              }}
              className="invoice-print-root !rounded-none !border-0 !shadow-none"
            />
          </article>
        ) : (
        <section className="mt-6 rounded-xl border border-border-default bg-surface">
          <div className="border-b border-border-default px-5 py-3">
            <h3 className="text-sm font-semibold text-text-primary">
              Line items
            </h3>
          </div>
          {invoice.lines.length === 0 ? (
            <p className="px-5 py-8 text-center text-sm text-text-caption">
              No line items stored on this invoice
              {invoice.orderNumber
                ? ` (created from order ${invoice.orderNumber}).`
                : "."}
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="min-w-full text-left text-sm">
                <thead className="bg-subtle text-xs font-medium tracking-wide text-text-caption uppercase">
                  <tr>
                    <th className="px-4 py-2">Item</th>
                    <th className="px-4 py-2">Qty</th>
                    <th className="px-4 py-2">Unit</th>
                    <th className="px-4 py-2">Tax %</th>
                    <th className="px-4 py-2">Amount (incl. tax)</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border-default">
                  {invoice.lines.map((line) => (
                    <tr
                      key={line.id}
                      className={
                        line.kind === "addon" ? "bg-subtle/40" : undefined
                      }
                    >
                      <td className="px-4 py-3">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="font-medium text-text-primary">
                            {line.name}
                          </span>
                          {line.kind === "addon" ? (
                            <span className="rounded-md bg-violet-0 px-1.5 py-0.5 text-[10px] font-medium text-brand">
                              Add-on
                            </span>
                          ) : null}
                        </div>
                        {line.description ? (
                          <p className="mt-0.5 text-xs text-text-caption">
                            {line.description}
                          </p>
                        ) : null}
                      </td>
                      <td className="px-4 py-3 text-text-primary">
                        {line.quantity}
                      </td>
                      <td className="px-4 py-3 text-text-primary">
                        {formatInvoiceMoney(line.unitPrice, invoice.currency)}
                      </td>
                      <td className="px-4 py-3 text-text-primary">
                        {line.taxPercent}
                      </td>
                      <td className="px-4 py-3 font-medium text-text-primary">
                        {formatInvoiceMoney(
                          String(
                            lineAmountWithTax(line.amount, line.taxPercent),
                          ),
                          invoice.currency,
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <div className="space-y-2 border-t border-border-default px-5 py-4 text-sm">
            <div className="flex justify-between gap-3">
              <span className="text-text-caption">Subtotal (excl. tax)</span>
              <span className="font-medium text-text-primary">
                {formatInvoiceMoney(String(subtotal), invoice.currency)}
              </span>
            </div>
            {Number(invoice.discountAmount) > 0 ? (
              <div className="flex justify-between gap-3">
                <span className="text-text-caption">Discount</span>
                <span className="font-medium text-text-primary">
                  −
                  {formatInvoiceMoney(invoice.discountAmount, invoice.currency)}
                </span>
              </div>
            ) : null}
            {Number(invoice.taxAmount) > 0 || invoice.taxDetails ? (
              <>
                {invoice.taxDetails?.components?.length ? (
                  invoice.taxDetails.components.map((c) => (
                    <div key={c.code} className="flex justify-between gap-3">
                      <span className="text-text-caption">
                        {c.label} ({c.percent}%)
                      </span>
                      <span className="font-medium text-text-primary">
                        {formatInvoiceMoney(String(c.amount), invoice.currency)}
                      </span>
                    </div>
                  ))
                ) : (
                  <div className="flex justify-between gap-3">
                    <span className="text-text-caption">
                      Tax
                      {invoice.taxDetails
                        ? ` · ${invoice.taxDetails.system} (${invoice.taxDetails.effectivePercent}%)`
                        : ""}
                    </span>
                    <span className="font-medium text-text-primary">
                      {formatInvoiceMoney(invoice.taxAmount, invoice.currency)}
                    </span>
                  </div>
                )}
                {invoice.taxDetails?.summaryLines?.length ? (
                  <div className="space-y-0.5 text-xs text-text-caption">
                    {invoice.taxDetails.summaryLines.map((line) => (
                      <p key={line}>{line}</p>
                    ))}
                  </div>
                ) : null}
              </>
            ) : null}
            <div className="flex justify-between gap-3 border-t border-border-default pt-2">
              <span className="font-medium text-text-primary">Amount due</span>
              <span className="text-lg font-semibold text-text-primary">
                {formatInvoiceMoney(invoice.total, invoice.currency)}
              </span>
            </div>
          </div>
        </section>
        )}

        {invoice.notes ? (
          <section className="mt-6 rounded-xl border border-border-default bg-surface p-5">
            <h3 className="text-sm font-semibold text-text-primary">Notes</h3>
            <RichStructuredContent
              className="mt-2"
              text={invoice.notes}
              variant="document"
            />
          </section>
        ) : null}
      </div>
    </FinanceShell>
  );

  return (
    <AgentModuleShell
      moduleId="finance"
      title={invoice.number}
      welcome={`I'm your **finance agent** for invoice **${invoice.number}**. ${
        canMutateInvoice && isDraft
          ? "Ask me to update line items, notes, or discount before you approve and send."
          : "Ask me about sending or marking it paid — the invoice stays fully usable on the right."
      }`}
      chips={[
        {
          id: "chip-help",
          label: "What can you help with?",
          prompt: "What can you help me do with this invoice?",
        },
        ...(canMutateInvoice && isDraft
          ? [
              {
                id: "chip-edit",
                label: "Edit line items",
                prompt:
                  "Update this invoice — change line items, quantity, discount, notes, or payment terms.",
              },
            ]
          : []),
      ]}
      surface="detail"
      entityId={invoiceId ?? null}
      workspace={workspace}
      onAfterTool={() => void reload()}
      onToolConfirm={async (tool: AgentToolProposal) => {
        const id = String(
          tool.args.invoiceId || invoiceId || invoice?.id || "",
        ).trim();
        if (tool.name === "propose_update_invoice") {
          if (!id) return "Missing invoice.";
          const patch: {
            notes?: string | null;
            paymentTerms?: string | null;
            discountAmount?: number | null;
            discountPct?: number | null;
            lines?: Array<{
              productId?: string | null;
              name: string;
              quantity: number;
              unitPrice: number;
            }>;
          } = {};
          if (typeof tool.args.notes === "string") patch.notes = tool.args.notes;
          if (typeof tool.args.paymentTerms === "string") {
            patch.paymentTerms = tool.args.paymentTerms;
          }
          if (
            tool.args.discountPct !== undefined &&
            tool.args.discountPct !== null &&
            String(tool.args.discountPct).trim() !== ""
          ) {
            const discount = toolNumber(tool.args.discountPct, Number.NaN);
            if (Number.isFinite(discount)) patch.discountPct = discount;
          }
          if (
            tool.args.discountAmount !== undefined &&
            tool.args.discountAmount !== null &&
            String(tool.args.discountAmount).trim() !== ""
          ) {
            const amount = toolNumber(tool.args.discountAmount, Number.NaN);
            if (Number.isFinite(amount)) patch.discountAmount = amount;
          }
          const lines = await resolveInvoiceLinesFromTool(tool.args.lines);
          if (lines) patch.lines = lines;
          if (Object.keys(patch).length === 0) return "Nothing to update.";
          const result = await updateInvoice(id, patch);
          if (!result.ok) return result.error ?? "Failed to update invoice.";
          await reload();
          return true;
        }
        if (tool.name === "propose_send_invoice") {
          if (!id) return "Missing invoice.";
          const result = await sendInvoiceEmail(id);
          if (!result.ok) return result.error ?? "Failed to send invoice.";
          await reload();
          return true;
        }
        if (tool.name === "propose_mark_invoice_paid") {
          if (!id) return "Missing invoice.";
          const result = await markInvoicePaid(id);
          if (!result.ok) return result.error ?? "Failed to mark invoice paid.";
          await reload();
          return true;
        }
        if (tool.name === "propose_delete_invoice") {
          if (!id) return "Missing invoice.";
          const result = await deleteInvoice(id);
          if (!result.ok) return result.error ?? "Failed to delete invoice.";
          navigate("/finance");
          return true;
        }
        return false;
      }}
    />
  );
}
