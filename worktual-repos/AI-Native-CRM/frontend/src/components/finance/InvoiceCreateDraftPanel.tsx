import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type MutableRefObject,
} from "react";
import { ArrowLeft } from "lucide-react";
import { CoworkerDraftPanel, DraftPanelFrame } from "@/components/coworker/CoworkerCreateShell";
import { GuidedSetupPanel } from "@/components/coworker/GuidedSetupPanel";
import { Button } from "@/components/ui/Button";
import { Select } from "@/components/ui/Select";
import { Textarea } from "@/components/ui/Textarea";
import { PaymentTermsField } from "@/components/finance/PaymentTermsField";
import { requiredProgress } from "@/lib/coworker/draft-progress";
import { normalizePaymentTerms } from "@/lib/invoice-payment-terms";
import {
  invoiceSetupHeadline,
  invoiceSetupSteps,
  resolveSetupSteps,
} from "@/lib/coworker/guided-setup-steps";
import type { InvoiceDraftFields } from "@/services/coworker";
import {
  createInvoice,
  fetchDealInvoiceAutofill,
  fetchInvoiceCreateOptions,
  type DealInvoiceOption,
} from "@/services/finance";

const CURRENCY_OPTIONS = [
  { value: "USD", label: "USD — US Dollar" },
  { value: "EUR", label: "EUR — Euro" },
  { value: "GBP", label: "GBP — British Pound" },
  { value: "INR", label: "INR — Indian Rupee" },
  { value: "AED", label: "AED — UAE Dirham" },
];

export function emptyInvoiceDraft(
  partial?: Partial<InvoiceDraftFields>,
): InvoiceDraftFields {
  return {
    dealId: "",
    currency: "",
    notes: "",
    paymentTerms: "",
    issueDate: "",
    dueDate: "",
    billingAddress: "",
    leadEmail: "",
    leadPhone: "",
    taxId: "",
    templateId: "",
    discountPct: "",
    productId: "",
    quantity: "",
    addonQuantities: {},
    ...partial,
  };
}

export type InvoiceCreateDraftPanelProps = {
  draft: InvoiceDraftFields;
  onDraftChange: (next: InvoiceDraftFields) => void;
  onContinue: () => void;
  onCreated?: (invoiceId: string) => void;
  onCancel?: () => void;
  patchRef?: MutableRefObject<
    ((patch: Partial<InvoiceDraftFields>) => void) | null
  >;
  submitRef?: MutableRefObject<(() => Promise<true | string>) | null>;
  mode?: "guided" | "form";
};

/**
 * Invoice create draft for in-shell workspace (no chat — agent lives in AgentModuleShell).
 * Hands off to the full invoice form for line items and tax.
 */
export function InvoiceCreateDraftPanel({
  draft,
  onDraftChange,
  onContinue,
  onCreated,
  onCancel,
  patchRef,
  submitRef,
  mode = "guided",
}: InvoiceCreateDraftPanelProps) {
  const [deals, setDeals] = useState<DealInvoiceOption[]>([]);
  const [products, setProducts] = useState<
    Array<{ id: string; name: string; price: string | null }>
  >([]);
  const [optsReady, setOptsReady] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void fetchInvoiceCreateOptions()
      .then((opts) => {
        if (cancelled || !opts.ok) return;
        setDeals(opts.deals);
        setProducts(
          opts.products.map((p) => ({
            id: p.id,
            name: p.name,
            price: p.price,
          })),
        );
        if (!draft.dealId && opts.deals[0]) {
          onDraftChange(
            emptyInvoiceDraft({
              ...draft,
              dealId: opts.deals[0].id,
            }),
          );
        }
      })
      .catch(() => setError("Failed to load create options."))
      .finally(() => {
        if (!cancelled) setOptsReady(true);
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- init defaults once
  }, []);

  const progress = requiredProgress([
    Boolean(draft.dealId),
  ]);
  /** Chat / submit still needs a product line; Continue to form only needs a deal. */
  const canCreateInvoice =
    Boolean(draft.dealId) && Boolean(draft.productId?.trim());

  const applyPatch = useCallback(
    (patch: Partial<InvoiceDraftFields>) => {
      const next = { ...draft, ...patch };
      if (patch.dealId && !deals.some((d) => d.id === patch.dealId)) {
        const match = deals.find(
          (d) =>
            d.title.toLowerCase() === (patch.dealId ?? "").toLowerCase(),
        );
        if (match) {
          next.dealId = match.id;
        } else if (deals.length === 0) {
          // Options not loaded yet — keep agent-provided id (don't wipe UUID).
          next.dealId = patch.dealId;
        } else {
          next.dealId = draft.dealId;
        }
      }
      onDraftChange(next);
    },
    [deals, draft, onDraftChange],
  );

  useEffect(() => {
    if (!patchRef) return;
    patchRef.current = applyPatch;
    return () => {
      patchRef.current = null;
    };
  }, [applyPatch, patchRef]);

  const doCreate = useCallback(async (): Promise<true | string> => {
    if (!canCreateInvoice) {
      const msg = draft.dealId
        ? "Pick a product and quantity in chat (or the draft) before creating an invoice — I won’t invent a line."
        : "Select a deal to continue.";
      setError(msg);
      return msg;
    }
    const productId = draft.productId.trim();
    const product =
      products.find((p) => p.id === productId) ??
      (productId ? null : null);
    if (!product) {
      const msg =
        "Pick a product and quantity in chat (or the draft) before creating an invoice — I won’t invent a line.";
      setError(msg);
      return msg;
    }
    const qty = Math.max(0.01, Number.parseFloat(draft.quantity || "1") || 1);
    setSaving(true);
    setError(null);
    const autofill = await fetchDealInvoiceAutofill(draft.dealId);
    if (!autofill.ok) {
      setSaving(false);
      setError(autofill.error);
      return autofill.error;
    }
    const unitPrice = Number.parseFloat(product.price ?? "0") || 0;
    const amount = qty * unitPrice;
    const tax = autofill.data.tax;
    const taxConfig =
      tax.country === "IN"
        ? {
            country: "IN" as const,
            gstRate: tax.indiaGstRate,
            sellerState: (tax.sellerState || "TN").trim() || "TN",
            buyerState: (tax.buyerState || "TN").trim() || "TN",
          }
        : tax.country === "UK"
          ? {
              country: "UK" as const,
              vatCategory: tax.ukVatCategory,
            }
          : {
              country: "US" as const,
              statePercent: tax.usStatePercent,
              countyPercent: tax.usCountyPercent,
              cityPercent: tax.usCityPercent,
              specialDistrictPercent: tax.usDistrictPercent,
            };
    const discountPct = Number.parseFloat(draft.discountPct || "0") || 0;
    const result = await createInvoice({
      dealId: draft.dealId,
      currency: draft.currency || autofill.data.currency,
      status: "draft",
      paymentTerms: normalizePaymentTerms(
        draft.paymentTerms || autofill.data.paymentTerms,
      ),
      notes: draft.notes || null,
      billingAddress: draft.billingAddress || autofill.data.billingAddress,
      leadEmail: draft.leadEmail || autofill.data.leadEmail,
      leadPhone: draft.leadPhone || autofill.data.leadPhone,
      taxId: draft.taxId || tax.taxId || null,
      issueDate: draft.issueDate || autofill.data.issueDate,
      dueAt: draft.dueDate || autofill.data.dueDate,
      taxConfig,
      ...(discountPct > 0 ? { discountPct } : {}),
      lines: [
        {
          kind: "product",
          productId: product.id,
          name: product.name,
          quantity: qty,
          unitPrice,
          amount,
        },
      ],
    });
    setSaving(false);
    if (!result.ok) {
      setError(result.error);
      return result.error || "Couldn't create invoice.";
    }
    onCreated?.(result.id);
    return true;
  }, [canCreateInvoice, draft, onCreated, products]);

  const requestCreate = useCallback((): Promise<true | string> => {
    if (!canCreateInvoice) {
      const msg = draft.dealId
        ? "Pick a product before I can save the invoice."
        : "Link a deal before I can save the invoice.";
      setError(msg);
      return Promise.resolve(msg);
    }
    return doCreate();
  }, [canCreateInvoice, doCreate, draft.dealId]);

  useEffect(() => {
    if (!submitRef) return;
    submitRef.current = requestCreate;
    return () => {
      submitRef.current = null;
    };
  }, [requestCreate, submitRef]);

  const handleContinue = () => {
    if (!progress.ready) {
      setError("Select a deal to continue.");
      return;
    }
    setError(null);
    onDraftChange({
      ...draft,
      paymentTerms: normalizePaymentTerms(draft.paymentTerms),
    });
    onContinue();
  };

  if (optsReady && deals.length === 0) {
    return (
      <div className="p-4 text-center text-sm text-text-caption">
        No open deals to invoice yet. Close a deal or link a company first.
        {onCancel ? (
          <div className="mt-3">
            <Button type="button" variant="secondary" onClick={onCancel}>
              <ArrowLeft className="size-4" strokeWidth={1.75} />
              Back to invoices
            </Button>
          </div>
        ) : null}
      </div>
    );
  }

  const guidedSteps = useMemo(() => {
    const defs = invoiceSetupSteps(
      (id) => {
        const d = deals.find((x) => x.id === id);
        return d ? `${d.title} — ${d.companyName}` : null;
      },
      (id) => products.find((p) => p.id === id)?.name ?? null,
    );
    return resolveSetupSteps(defs, draft);
  }, [deals, draft, products]);

  if (mode === "guided") {
    return (
      <GuidedSetupPanel
        setupTitle="Invoice setup"
        headline={invoiceSetupHeadline(draft)}
        steps={guidedSteps}
        error={error}
        secondaryAction={{
          label: "Open full invoice builder",
          onClick: handleContinue,
        }}
        onCancel={onCancel}
      />
    );
  }

  return (
    <DraftPanelFrame>
      <CoworkerDraftPanel
        title="Invoice draft"
        progressLabel={`${progress.filled}/${progress.total} ready`}
        progressRatio={progress.ratio}
        footer={
          <>
            <Button
              type="button"
              variant="primary"
              disabled={!progress.ready || saving}
              onClick={() => void handleContinue()}
            >
              {saving ? "Creating…" : "Continue to invoice form"}
            </Button>
            {onCancel ? (
                <Button type="button" variant="secondary" onClick={onCancel}>
                  <ArrowLeft className="size-4" strokeWidth={1.75} />
                  Back
                </Button>
            ) : null}
          </>
        }
      >
        <Select
          label="Deal"
          required
          value={draft.dealId}
          onChange={(e) =>
            onDraftChange({ ...draft, dealId: e.target.value })
          }
          options={
            !optsReady && deals.length === 0
              ? [{ value: "", label: "Loading deals…" }]
              : [
                  { value: "", label: "Select a deal…" },
                  ...deals.map((d) => ({
                    value: d.id,
                    label: `${d.title} — ${d.companyName}`,
                  })),
                ]
          }
        />
        <div className="grid gap-3 sm:grid-cols-2">
          <Select
            label="Currency"
            value={draft.currency}
            onChange={(e) =>
              onDraftChange({ ...draft, currency: e.target.value })
            }
            options={CURRENCY_OPTIONS}
          />
          <PaymentTermsField
            value={draft.paymentTerms}
            onChange={(paymentTerms) =>
              onDraftChange({ ...draft, paymentTerms })
            }
          />
        </div>
        <Textarea
          label="Notes"
          value={draft.notes}
          onChange={(e) => onDraftChange({ ...draft, notes: e.target.value })}
        />
        <p className="text-xs text-text-caption">
          Line items, add-ons, and tax are finished on the invoice form after
          you continue.
        </p>
        {error ? <p className="text-sm text-text-danger">{error}</p> : null}
      </CoworkerDraftPanel>
    </DraftPanelFrame>
  );
}
