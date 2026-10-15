import { useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { AgentModuleShell } from "@/components/coworker/AgentModuleShell";
import {
  DocumentBlueprintView,
  formatCompanyDisplayName,
  formatSectionBodyHtml,
} from "@/components/documents/DocumentBlueprintView";
import { RichStructuredContent } from "@/components/content/RichStructuredContent";
import { Button } from "@/components/ui/Button";
import { BackLink } from "@/components/ui/BackLink";
import { Input } from "@/components/ui/Input";
import { Textarea } from "@/components/ui/Textarea";
import { PAGE_H1_CLASS } from "@/lib/ui-tones";
import { canEditFinance, canEditQuotes, normalizeRole } from "@/lib/rbac";
import {
  acceptQuote,
  approveQuoteDiscount,
  deleteQuote,
  downloadQuotePdf,
  fetchQuote,
  fetchQuoteFormOptions,
  rejectQuote,
  rejectQuoteDiscount,
  sendQuote,
  resendQuote,
  updateQuote,
  rewriteQuoteSection,
  updateQuoteDocumentAsset,
  type QuoteDetail,
  type QuoteDocumentSection,
  type QuoteFormProduct,
} from "@/services/quotes";
import { useAppSelector } from "@/store";
import type { AgentToolProposal } from "@/services/coworker";

const STATUS_LABEL: Record<string, string> = {
  draft: "Draft",
  sent: "Sent",
  accepted: "Accepted",
  rejected: "Rejected",
  void: "Void",
};

function formatMoney(amount: string | number, currency: string) {
  const n = typeof amount === "number" ? amount : Number(amount);
  const value = Number.isFinite(n) ? n : 0;
  try {
    return new Intl.NumberFormat(undefined, {
      style: "currency",
      currency: currency || "USD",
      maximumFractionDigits: 2,
    }).format(value);
  } catch {
    return `${currency || "USD"} ${value.toFixed(2)}`;
  }
}

function formatDate(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

function toolNumber(value: unknown, fallback: number): number {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim()) {
    const n = Number(value);
    if (Number.isFinite(n)) return n;
  }
  return fallback;
}

function productListPrice(product: QuoteFormProduct): number {
  const n = Number(product.listPrice ?? product.basePrice ?? product.price ?? 0);
  return Number.isFinite(n) ? Math.max(0, n) : 0;
}

function matchQuoteProduct(
  products: QuoteFormProduct[],
  productId: string,
  name: string,
): QuoteFormProduct | undefined {
  const id = productId.trim();
  const nm = name.trim().toLowerCase();
  if (id) {
    const exact = products.find((p) => p.id === id);
    if (exact) return exact;
  }
  if (!nm) return undefined;
  return (
    products.find((p) => p.name.toLowerCase() === nm) ||
    products.find(
      (p) => p.name.toLowerCase().includes(nm) || nm.includes(p.name.toLowerCase()),
    )
  );
}

async function resolveQuoteLinesFromTool(raw: unknown): Promise<
  | Array<{
      productId?: string | null;
      name: string;
      quantity: number;
      unitPrice: number;
    }>
  | null
> {
  if (!Array.isArray(raw) || raw.length === 0) return null;
  const options = await fetchQuoteFormOptions().catch(() => null);
  const products = options && "products" in options ? options.products : [];
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
    const product = matchQuoteProduct(products, productId, nameRaw);
    const name = (product?.name || nameRaw).trim();
    if (!name) continue;
    out.push({
      productId: product?.id ?? (productId || null),
      name,
      quantity: Math.max(0.01, toolNumber(rec.quantity, 1)),
      unitPrice: Math.max(
        0,
        toolNumber(rec.unitPrice, product ? productListPrice(product) : 0),
      ),
    });
  }
  return out.length ? out : null;
}

function cell(value: string | number): string {
  return String(value ?? "")
    .replace(/\|/g, "/")
    .replace(/\n+/g, " ")
    .trim();
}

/** Merge live quote lines into a line_items section for blueprint preview. */
function sectionsWithLineItems(
  sections: QuoteDocumentSection[],
  quote: QuoteDetail,
): QuoteDocumentSection[] {
  const header =
    "| Item | Qty | Unit price | Amount |\n| --- | --- | --- | --- |";
  const rows = quote.lines.map((line) => {
    return `| ${cell(line.name)} | ${cell(line.quantity)} | ${cell(formatMoney(line.unitPrice, quote.currency))} | ${cell(formatMoney(line.amount, quote.currency))} |`;
  });
  const discountPct = Number(quote.discountPct);
  const discountAmount =
    Number(quote.subtotal) * (Number.isFinite(discountPct) ? discountPct : 0) /
    100;
  const totals = [
    `Subtotal: ${formatMoney(quote.subtotal, quote.currency)}`,
    discountAmount > 0
      ? `Discount (${discountPct}%): ${formatMoney(discountAmount, quote.currency)}`
      : null,
    `**Total: ${formatMoney(quote.total, quote.currency)}**`,
  ]
    .filter(Boolean)
    .join("\n");
  const body = `${quote.lines.length ? [header, ...rows].join("\n") : "_No line items._"}\n\n${totals}`;

  const existing = sections.findIndex(
    (s) => (s.key || "").toLowerCase() === "line_items",
  );
  if (existing >= 0) {
    return sections.map((s, i) =>
      i === existing ? { ...s, title: s.title || "Line items", body } : s,
    );
  }
  const introIdx = sections.findIndex(
    (s) => (s.key || "").toLowerCase() === "introduction",
  );
  const insertAt = introIdx >= 0 ? introIdx + 1 : 0;
  const next = sections.slice();
  next.splice(insertAt, 0, {
    id: "sec-line-items",
    key: "line_items",
    title: "Line items",
    body,
    sortOrder: insertAt + 1,
  });
  return next.map((s, i) => ({ ...s, sortOrder: i + 1 }));
}

function statusPillClass(status: string) {
  switch (status) {
    case "accepted":
      return "rounded-md bg-emerald-50 px-2 py-0.5 text-xs font-medium text-emerald-800";
    case "sent":
      return "rounded-md bg-sky-50 px-2 py-0.5 text-xs font-medium text-sky-800";
    case "rejected":
    case "void":
      return "rounded-md bg-rose-50 px-2 py-0.5 text-xs font-medium text-rose-800";
    default:
      return "rounded-md bg-subtle px-2 py-0.5 text-xs font-medium text-text-secondary";
  }
}

function QuoteLinesTable({ quote }: { quote: QuoteDetail }) {
  if (quote.lines.length === 0) {
    return (
      <p className="mt-3 text-sm text-text-caption">
        No line items on this quote.
      </p>
    );
  }
  return (
    <div className="mt-3 overflow-x-auto">
      <table className="min-w-full text-left text-sm">
        <thead className="border-b border-border-default text-xs font-medium tracking-wide text-text-caption uppercase">
          <tr>
            <th className="py-2 pr-3">Description</th>
            <th className="py-2 pr-3">Qty</th>
            <th className="py-2 pr-3">Unit price</th>
            <th className="py-2">Subtotal</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-border-default">
          {quote.lines.map((line) => (
            <tr key={line.id}>
              <td className="py-3 pr-3 font-medium text-text-primary">
                {line.name}
              </td>
              <td className="py-3 pr-3 text-text-secondary">{line.quantity}</td>
              <td className="py-3 pr-3 text-text-secondary">
                {formatMoney(line.unitPrice, quote.currency)}
              </td>
              <td className="py-3 text-text-primary">
                {formatMoney(line.amount, quote.currency)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function QuoteFinancialSummary({ quote }: { quote: QuoteDetail }) {
  return (
    <section className="border-t border-border-default pt-5">
      <h2 className="text-sm font-semibold text-text-primary">
        Financial summary
      </h2>
      <dl className="mt-3 space-y-1.5 text-sm">
        <div className="flex justify-between gap-4">
          <dt className="text-text-caption">Subtotal</dt>
          <dd className="tabular-nums text-text-primary">
            {formatMoney(quote.subtotal, quote.currency)}
          </dd>
        </div>
        {Number(quote.discountPct) > 0 ? (
          <div className="flex justify-between gap-4">
            <dt className="text-text-caption">
              Discount ({Number(quote.discountPct)}%)
            </dt>
            <dd className="tabular-nums text-text-primary">
              −
              {formatMoney(
                Number(quote.subtotal) * (Number(quote.discountPct) / 100),
                quote.currency,
              )}
            </dd>
          </div>
        ) : null}
        <div className="flex justify-between gap-4 border-t border-border-default pt-2 text-base font-semibold">
          <dt className="text-text-primary">Total amount</dt>
          <dd className="tabular-nums text-text-primary">
            {formatMoney(quote.total, quote.currency)}
          </dd>
        </div>
      </dl>
      {quote.amountInWords ? (
        <p className="mt-3 text-sm text-text-secondary">
          Amount in words: {quote.amountInWords}
        </p>
      ) : null}
    </section>
  );
}

export function QuoteDetailPage() {
  const { quoteId } = useParams<{ quoteId: string }>();
  const navigate = useNavigate();
  const user = useAppSelector((s) => s.auth.user);
  const canEdit = canEditQuotes(normalizeRole(user?.role));
  const canApproveDiscount = canEditFinance(normalizeRole(user?.role));
  const [quote, setQuote] = useState<QuoteDetail | null>(null);
  const [sections, setSections] = useState<QuoteDocumentSection[]>([]);
  const [vendorName, setVendorName] = useState("");
  const [companyName, setCompanyName] = useState("");
  const [customerName, setCustomerName] = useState("");
  const [notes, setNotes] = useState("");
  const [editing, setEditing] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [createdInvoiceId, setCreatedInvoiceId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [rejectOpen, setRejectOpen] = useState(false);
  const [rejectReason, setRejectReason] = useState("");

  const applyQuoteLocal = (q: QuoteDetail) => {
    setQuote(q);
    setSections(q.documentSections ?? []);
    setVendorName(q.vendorName ?? "");
    setCompanyName(q.companyName ?? "");
    setCustomerName(q.customerName ?? "");
    setNotes(q.notes ?? "");
  };

  const reload = async () => {
    if (!quoteId) return;
    setLoading(true);
    setError(null);
    try {
      const result = await fetchQuote(quoteId);
      if (!result.ok) {
        setQuote(null);
        setError(result.error);
        return;
      }
      applyQuoteLocal(result.quote);
    } catch {
      setError("Failed to load quote.");
      setQuote(null);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [quoteId]);

  const run = async (
    fn: () => Promise<{
      ok: boolean;
      error?: string;
      warning?: string;
      invoiceId?: string | null;
    }>,
  ) => {
    setBusy(true);
    setError(null);
    setMessage(null);
    setCreatedInvoiceId(null);
    const result = await fn();
    setBusy(false);
    if (!result.ok) {
      setError(result.error ?? "Action failed.");
      return;
    }
    if (result.warning) setMessage(result.warning);
    if (result.invoiceId) {
      setMessage("Invoice created from accepted quote.");
      setCreatedInvoiceId(result.invoiceId);
    }
    await reload();
  };

  const onSave = async () => {
    if (!quote) return;
    setBusy(true);
    setError(null);
    const result = await updateQuote(quote.id, {
      documentSections: sections,
      vendorName,
      companyName,
      customerName,
      notes: notes.trim() || null,
    });
    setBusy(false);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    setEditing(false);
    await reload();
  };

  const resetEdit = () => {
    if (!quote) return;
    setEditing(false);
    setSections(quote.documentSections ?? []);
    setVendorName(quote.vendorName ?? "");
    setCompanyName(quote.companyName ?? "");
    setCustomerName(quote.customerName ?? "");
    setNotes(quote.notes ?? "");
  };

  if (loading) {
    return (
      <AgentModuleShell
        moduleId="quotes"
        title="Quote"
        welcome="Loading this quote on the right."
        surface="detail"
        entityId={quoteId ?? null}
        workspace={
          <div className="px-6 py-10 text-sm text-text-caption">Loading…</div>
        }
      />
    );
  }

  if (!quote) {
    return (
      <AgentModuleShell
        moduleId="quotes"
        title="Quote"
        welcome="I can help with quotes while you use the workspace."
        surface="detail"
        entityId={quoteId ?? null}
        workspace={
          <div className="px-6 py-10">
            <p className="text-sm text-text-danger">{error ?? "Not found"}</p>
            <BackLink to="/sales/quotes" className="mt-3">
              Back to Quotes
            </BackLink>
          </div>
        }
      />
    );
  }

  const pendingFinanceApproval = quote.approvalStatus === "pending_finance_approval";
  const financeRejected = quote.approvalStatus === "finance_rejected";
  const introIndex = sections.findIndex((s) => s.key === "introduction");
  const commercialAfterIndex = introIndex >= 0 ? introIndex : -1;
  const spreadsheetLayout = quote.blueprint?.mode === "spreadsheet-layout";
  const previewSections = spreadsheetLayout
    ? sections
    : sectionsWithLineItems(sections, quote);
  const companyDisplay = formatCompanyDisplayName(
    companyName || customerName || "Customer",
  );
  const blueprintTokens = {
    customerName: companyDisplay,
    companyName: companyDisplay,
    dealTitle: quote.dealTitle || "",
    date: formatDate(quote.updatedAt),
    vendorName: vendorName.trim() || "Our company",
    documentTitle: "Quotation",
    quoteNumber: quote.number,
    currency: quote.currency,
    subtotal: quote.subtotal,
    discountPct: quote.discountPct,
    total: quote.total,
    validUntil: formatDate(quote.validUntil),
  };

  const workspace = (
    <div className="crm-fade-in px-4 py-5 sm:px-6 print:px-0">
      <div className="mb-5 flex flex-wrap items-start justify-between gap-3 print:hidden">
        <div className="min-w-0">
          <BackLink to={`/sales/${quote.dealId}`}>Back to deal</BackLink>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <h1 className={PAGE_H1_CLASS}>{quote.number}</h1>
            <span className={statusPillClass(quote.status)}>
              {STATUS_LABEL[quote.status] ?? quote.status}
            </span>
          </div>
          <p className="mt-1 text-sm text-text-caption">
            {quote.templateName ? `From ${quote.templateName} · ` : null}
            Deal{" "}
            <Link
              to={`/sales/${quote.dealId}`}
              className="font-medium text-brand underline"
            >
              {quote.dealTitle}
            </Link>
            {" · "}
            <Link
              to="/configuration/quote-templates"
              className="text-brand underline"
            >
              Edit standard template
            </Link>
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {canEdit && !editing ? (
            <Button
              type="button"
              variant="secondary"
              className="h-9"
              onClick={() => setEditing(true)}
            >
              Edit document
            </Button>
          ) : null}
          {canEdit && editing ? (
            <>
              <Button
                type="button"
                variant="primary"
                className="h-9"
                disabled={busy}
                onClick={() => void onSave()}
              >
                {busy ? "Saving…" : "Save"}
              </Button>
              <Button
                type="button"
                variant="secondary"
                className="h-9"
                onClick={resetEdit}
              >
                Cancel
              </Button>
            </>
          ) : null}
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
                  const blob = await downloadQuotePdf(quote.id);
                  const url = URL.createObjectURL(blob);
                  const a = document.createElement("a");
                  a.href = url;
                  a.download = `${quote.number || "quote"}.pdf`;
                  a.click();
                  URL.revokeObjectURL(url);
                } catch (err) {
                  setError(
                    err instanceof Error
                      ? err.message
                      : "Could not download PDF. Try Print, or ask an admin to install Playwright Chromium on the API.",
                  );
                } finally {
                  setBusy(false);
                }
              })()
            }
          >
            Download PDF
          </Button>
          <Button
            type="button"
            variant="secondary"
            className="h-9"
            onClick={() => window.print()}
          >
            Print
          </Button>
          {canEdit && quote.status === "draft" ? (
            <Button
              type="button"
              variant="secondary"
              className="h-9"
              disabled={
                busy || editing || pendingFinanceApproval || financeRejected
              }
              title={
                pendingFinanceApproval
                  ? "Blocked until Finance approves this quote's discount."
                  : financeRejected
                    ? "Discount was rejected — revise and save before sending."
                    : undefined
              }
              onClick={() => void run(() => sendQuote(quote.id))}
            >
              Send
            </Button>
          ) : null}
          {canApproveDiscount && pendingFinanceApproval ? (
            <>
              <Button
                type="button"
                variant="primary"
                className="h-9"
                disabled={busy || editing}
                onClick={() => void run(() => approveQuoteDiscount(quote.id))}
              >
                Approve discount
              </Button>
              <Button
                type="button"
                variant="secondary"
                className="h-9"
                disabled={busy || editing}
                onClick={() => {
                  setRejectOpen((v) => !v);
                  setRejectReason("");
                  setError(null);
                }}
              >
                Reject discount
              </Button>
            </>
          ) : null}
          {canEdit && quote.status === "sent" ? (
            <>
              <Button
                type="button"
                variant="secondary"
                className="h-9"
                disabled={busy || editing}
                onClick={() => void run(() => resendQuote(quote.id))}
              >
                Resend email
              </Button>
              <Button
                type="button"
                variant="primary"
                className="h-9"
                disabled={busy || editing}
                onClick={() => void run(() => acceptQuote(quote.id))}
              >
                Accept
              </Button>
              <Button
                type="button"
                variant="secondary"
                className="h-9"
                disabled={busy || editing}
                onClick={() => void run(() => rejectQuote(quote.id))}
              >
                Reject
              </Button>
            </>
          ) : null}
        </div>
      </div>

      {pendingFinanceApproval ? (
        <div className="mb-4 rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900 print:hidden">
          <p className="font-medium">Pending Finance approval</p>
          <p className="mt-0.5">
            This quote&rsquo;s {quote.discountPct}% discount exceeds the
            {quote.discountLimitPct != null
              ? ` ${quote.discountLimitPct}%`
              : ""}{" "}
            limit for one or more products on it. It can&rsquo;t be sent to
            the customer until Finance approves or rejects.
          </p>
          {rejectOpen && canApproveDiscount ? (
            <div className="mt-3 space-y-2 border-t border-amber-200 pt-3">
              <Textarea
                label="Rejection reason"
                value={rejectReason}
                onChange={(e) => setRejectReason(e.target.value)}
                rows={3}
                placeholder="Explain what the salesperson should change…"
              />
              <div className="flex flex-wrap gap-2">
                <Button
                  type="button"
                  variant="primary"
                  className="h-9"
                  disabled={busy || !rejectReason.trim()}
                  onClick={() =>
                    void run(async () => {
                      const result = await rejectQuoteDiscount(
                        quote.id,
                        rejectReason,
                      );
                      if (result.ok) {
                        setRejectOpen(false);
                        setRejectReason("");
                      }
                      return result;
                    })
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
        </div>
      ) : null}

      {financeRejected ? (
        <div className="mb-4 rounded-lg border border-red-300 bg-red-50 px-4 py-3 text-sm text-red-900 print:hidden">
          <p className="font-medium">Discount rejected by Finance</p>
          <p className="mt-0.5">
            {quote.approvalNote?.trim()
              ? quote.approvalNote.trim()
              : "Revise the discount (or lines) and save to re-submit for approval."}
          </p>
        </div>
      ) : null}

      {error ? (
        <p className="mb-4 text-sm text-text-danger print:hidden" role="alert">
          {error}
        </p>
      ) : null}
      {message ? (
        <p className="mb-4 text-sm text-text-secondary print:hidden">
          {message}{" "}
          <Link
            to={createdInvoiceId ? `/finance/${createdInvoiceId}` : "/finance"}
            className="text-brand underline"
          >
            {createdInvoiceId ? "Open invoice" : "Open Finance"}
          </Link>
        </p>
      ) : null}

      <article className="mx-auto w-full max-w-6xl rounded-xl border border-border-default bg-surface p-6 sm:p-8 print:border-0 print:p-0">
        {editing ? (
          <header className="mb-8 border-b border-border-default pb-6">
            <div className="space-y-3 print:hidden">
              <Input
                label="Vendor / company name"
                value={vendorName}
                onChange={(e) => setVendorName(e.target.value)}
              />
              <div className="grid gap-3 sm:grid-cols-2">
                <Input
                  label="Customer / company"
                  value={companyName}
                  onChange={(e) => setCompanyName(e.target.value)}
                />
                <Input
                  label="Bill to (contact)"
                  value={customerName}
                  onChange={(e) => setCustomerName(e.target.value)}
                />
              </div>
              <p className="text-xs text-text-caption">
                Quote #: {quote.number} · Date: {formatDate(quote.createdAt)}
                {quote.validUntil
                  ? ` · Valid until: ${formatDate(quote.validUntil)}`
                  : ""}
                {" · "}
                {quote.dealTitle}
              </p>
            </div>
          </header>
        ) : quote.blueprint ? null : (
          <header className="mb-8 border-b border-border-default pb-6">
            <p className="text-xs font-medium tracking-wide text-text-caption uppercase">
              Quotation {quote.number}
            </p>
            <h2 className="mt-2 text-2xl font-semibold tracking-tight text-text-primary">
              {quote.vendorName || "Quotation"}
            </h2>
            <p className="mt-2 text-sm text-text-secondary">
              Submitted to{" "}
              <span className="font-medium text-text-primary">
                {quote.companyName || quote.customerName || "Customer"}
              </span>
              {quote.customerName &&
              quote.companyName &&
              quote.customerName !== quote.companyName
                ? ` · Bill to ${quote.customerName}`
                : null}
              {quote.dealTitle ? ` · ${quote.dealTitle}` : null}
            </p>
            <p className="mt-1 text-xs text-text-caption">
              {formatDate(quote.createdAt)}
              {quote.validUntil
                ? ` · Valid until ${formatDate(quote.validUntil)}`
                : ""}
            </p>
          </header>
        )}

        <div className="space-y-8">
          {editing ? (
            sections.length === 0 ? (
              <p className="text-sm text-text-caption">
                No structured sections yet. Save header fields above, or create
                a new quote so the standard template sections are applied.
              </p>
            ) : (
              sections.map((section, idx) => (
                <section key={section.id}>
                  <div className="space-y-2 print:hidden">
                    <Input
                      label={`Section ${idx + 1} title`}
                      value={section.title}
                      onChange={(e) => {
                        const next = sections.slice();
                        next[idx] = { ...section, title: e.target.value };
                        setSections(next);
                      }}
                    />
                    <Textarea
                      label="Body"
                      rows={8}
                      value={section.body}
                      onChange={(e) => {
                        const next = sections.slice();
                        next[idx] = { ...section, body: e.target.value };
                        setSections(next);
                      }}
                    />
                  </div>
                </section>
              ))
            )
          ) : quote.blueprint ? (
            <DocumentBlueprintView
              blueprint={quote.blueprint}
              assets={quote.assets}
              sections={previewSections}
              tokens={blueprintTokens}
              className="quote-print-root"
            />
          ) : sections.length === 0 ? (
            <p className="text-sm text-text-caption">
              No structured document sections. Use Edit document for header
              fields, or create a quote from the standard template.
            </p>
          ) : (
            sections.map((section, idx) => (
              <div key={section.id} className="space-y-8">
                <section>
                  <h3 className="text-base font-semibold text-text-primary">
                    {section.title}
                  </h3>
                  <RichStructuredContent
                    className="mt-3"
                    html={formatSectionBodyHtml(section.body)}
                    variant="document"
                  />
                </section>

                {idx === commercialAfterIndex ? (
                  <>
                    <section>
                      <h3 className="text-base font-semibold text-text-primary">
                        Items
                      </h3>
                      <QuoteLinesTable quote={quote} />
                    </section>
                    <QuoteFinancialSummary quote={quote} />
                  </>
                ) : null}
              </div>
            ))
          )}

          {!editing && !quote.blueprint &&
          (sections.length === 0 || commercialAfterIndex < 0) ? (
            <>
              <section>
                <h3 className="text-base font-semibold text-text-primary">
                  Items
                </h3>
                <QuoteLinesTable quote={quote} />
              </section>
              <QuoteFinancialSummary quote={quote} />
            </>
          ) : null}

          {editing || !quote.blueprint ? (
            <section>
              {editing ? (
                <Textarea
                  label="Notes"
                  rows={4}
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  className="print:hidden"
                />
              ) : quote.notes ? (
                <>
                  <h3 className="text-base font-semibold text-text-primary">
                    Notes
                  </h3>
                  <RichStructuredContent
                    className="mt-3"
                    text={quote.notes}
                    variant="document"
                  />
                </>
              ) : null}
            </section>
          ) : null}

          {quote.proposalLabel ? (
            <p className="text-xs text-text-caption print:hidden">
              Linked proposal: {quote.proposalLabel}
            </p>
          ) : null}
        </div>
      </article>
    </div>
  );

  return (
    <AgentModuleShell
      moduleId="quotes"
      title={quote.number}
      welcome={`This is quote ${quote.number}. Ask me to change any section (content or heading), update the logo, edit lines, or send it.`}
      surface="detail"
      entityId={quote.id}
      workspace={workspace}
      onAfterTool={() => void reload()}
      onToolConfirm={async (tool: AgentToolProposal) => {
        if (tool.name === "propose_update_quote") {
          const id = String(tool.args.quoteId || quote.id || "").trim();
          if (!id) return "Missing quote.";
          const patch: {
            notes?: string | null;
            customerName?: string | null;
            companyName?: string | null;
            vendorName?: string | null;
            discountPct?: number | null;
            documentSections?: QuoteDocumentSection[];
            lines?: Array<{
              productId?: string | null;
              name: string;
              quantity: number;
              unitPrice: number;
            }>;
          } = {};
          if (typeof tool.args.notes === "string") patch.notes = tool.args.notes;
          if (typeof tool.args.customerName === "string") {
            patch.customerName = tool.args.customerName;
          }
          if (typeof tool.args.companyName === "string") {
            patch.companyName = tool.args.companyName;
          }
          if (typeof tool.args.vendorName === "string") {
            patch.vendorName = tool.args.vendorName;
          }
          if (
            tool.args.discountPct !== undefined &&
            tool.args.discountPct !== null &&
            String(tool.args.discountPct).trim() !== ""
          ) {
            const discount = toolNumber(tool.args.discountPct, Number.NaN);
            if (Number.isFinite(discount)) patch.discountPct = discount;
          }
          const lines = await resolveQuoteLinesFromTool(tool.args.lines);
          if (lines) patch.lines = lines;
          const sections = tool.args.documentSections;
          if (Array.isArray(sections) && sections.length > 0) {
            patch.documentSections = sections.map((row, idx) => {
              const item = row as Record<string, unknown>;
              return {
                id: String(item.id || `sec-${idx}`),
                key: String(item.key || `section-${idx}`),
                title: String(item.title || item.key || "Section"),
                body: String(item.body || ""),
                sortOrder: Number(item.sortOrder ?? idx + 1),
              };
            });
          }
          const sectionUpdates = tool.args.sectionUpdates;
          if (Array.isArray(sectionUpdates) && sectionUpdates.length > 0) {
            const base = [...(quote.documentSections ?? [])];
            for (const row of sectionUpdates) {
              const item = row as Record<string, unknown>;
              const key = String(item.key || "").trim();
              if (!key) continue;
              const idx = base.findIndex((s) => s.key === key);
              const prev = idx >= 0 ? base[idx]! : null;
              const next: QuoteDocumentSection = {
                id: prev?.id ?? `sec-${key}`,
                key,
                title:
                  typeof item.title === "string" && item.title.trim()
                    ? item.title.trim()
                    : prev?.title ?? key,
                body:
                  typeof item.body === "string"
                    ? item.body
                    : prev?.body ?? "",
                sortOrder: prev?.sortOrder ?? base.length + 1,
              };
              if (idx >= 0) base[idx] = next;
              else base.push(next);
            }
            patch.documentSections = base;
          }
          if (Object.keys(patch).length === 0) return "Nothing to update.";
          const result = await updateQuote(id, patch);
          if (!result.ok) return result.error ?? "Failed to update quote.";
          await reload();
          return true;
        }
        if (tool.name === "propose_rewrite_quote_section") {
          const id = String(tool.args.quoteId || quote.id || "").trim();
          const sectionKey = String(tool.args.sectionKey || "").trim();
          if (!id || !sectionKey) return "Missing quote or section.";
          const instruction =
            typeof tool.args.instruction === "string"
              ? tool.args.instruction
              : undefined;
          const result = await rewriteQuoteSection(id, {
            sectionKey,
            instruction,
          });
          if (!result.ok) return result.error;
          await reload();
          return true;
        }
        if (tool.name === "propose_update_document_asset") {
          const id = String(tool.args.quoteId || quote.id || "").trim();
          if (!id) return "Missing quote.";
          const result = await updateQuoteDocumentAsset(id, {
            assetId:
              typeof tool.args.assetId === "string"
                ? tool.args.assetId
                : "logo",
            imageUrl:
              typeof tool.args.imageUrl === "string"
                ? tool.args.imageUrl
                : undefined,
            dataBase64:
              typeof tool.args.dataBase64 === "string"
                ? tool.args.dataBase64
                : undefined,
            mime:
              typeof tool.args.mime === "string" ? tool.args.mime : undefined,
            kind:
              tool.args.kind === "logo" || tool.args.kind === "image"
                ? tool.args.kind
                : undefined,
          });
          if (!result.ok) return result.error;
          await reload();
          return true;
        }
        if (tool.name === "propose_send_quote") {
          const id = String(tool.args.quoteId || quote.id || "").trim();
          if (!id) return "Missing quote.";
          const result = await sendQuote(id);
          if (!result.ok) return result.error ?? "Failed to send quote.";
          if (result.warning) setMessage(result.warning);
          await reload();
          return true;
        }
        if (tool.name === "propose_delete_quote") {
          const id = String(tool.args.quoteId || quote.id || "").trim();
          if (!id) return "Missing quote.";
          const result = await deleteQuote(id);
          if (!result.ok) return result.error ?? "Failed to delete quote.";
          navigate("/sales/quotes");
          return true;
        }
        return false;
      }}
    />
  );
}
