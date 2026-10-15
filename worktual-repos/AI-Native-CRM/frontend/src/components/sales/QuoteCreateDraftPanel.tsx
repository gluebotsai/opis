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
import { Checkbox } from "@/components/ui/Checkbox";
import { Input } from "@/components/ui/Input";
import { Select } from "@/components/ui/Select";
import { requiredProgress } from "@/lib/coworker/draft-progress";
import {
  quoteSetupHeadline,
  quoteSetupSteps,
  resolveSetupSteps,
} from "@/lib/coworker/guided-setup-steps";
import {
  buildQuoteLines,
  estimateQuoteTotal,
} from "@/lib/quote-line-builder";
import type { QuoteDraftFields } from "@/services/coworker";
import {
  createQuote,
  fetchQuoteFormOptions,
  type QuoteFormAddon,
  type QuoteFormProduct,
} from "@/services/quotes";

export function emptyQuoteDraft(
  partial?: Partial<QuoteDraftFields>,
): QuoteDraftFields {
  return {
    dealId: "",
    discountPct: "",
    productId: "",
    quantity: "",
    offerId: "",
    addonQuantities: {},
    ...partial,
  };
}

export type QuoteCreateDraftPanelProps = {
  draft: QuoteDraftFields;
  onDraftChange: (next: QuoteDraftFields) => void;
  onCreated: (quoteId: string) => void;
  onCancel?: () => void;
  initialDealId?: string;
  patchRef?: MutableRefObject<
    ((patch: Partial<QuoteDraftFields>) => void) | null
  >;
  submitRef?: MutableRefObject<(() => Promise<true | string>) | null>;
  mode?: "guided" | "form";
};

function formatMoney(amount: number, currency: string) {
  try {
    return new Intl.NumberFormat(undefined, {
      style: "currency",
      currency: currency || "USD",
      maximumFractionDigits: 2,
    }).format(amount);
  } catch {
    return `${currency || "USD"} ${amount.toFixed(2)}`;
  }
}

function priceLabel(amount: string | null, currency: string) {
  if (amount == null || amount === "") return "";
  const n = Number(amount);
  if (!Number.isFinite(n)) return "";
  return ` (${formatMoney(n, currency)})`;
}

function addonUnitHint(addon: QuoteFormAddon): string {
  if (addon.unitLabel?.trim()) return addon.unitLabel.trim();
  if (addon.meterKey) return addon.meterKey;
  if (addon.pricingModel === "flat") return "units";
  return "qty";
}

function toAddonQuantities(draft: QuoteDraftFields): Record<string, number> {
  const out: Record<string, number> = {};
  for (const [id, raw] of Object.entries(draft.addonQuantities ?? {})) {
    const n = Number.parseFloat(raw);
    if (Number.isFinite(n) && n > 0) out[id] = n;
  }
  return out;
}

/**
 * Quote create form for in-shell workspace (no chat — agent lives in AgentModuleShell).
 */
export function QuoteCreateDraftPanel({
  draft,
  onDraftChange,
  onCreated,
  onCancel,
  initialDealId = "",
  patchRef,
  submitRef,
  mode = "guided",
}: QuoteCreateDraftPanelProps) {
  const [optsReady, setOptsReady] = useState(false);
  const [deals, setDeals] = useState<Array<{ id: string; title: string }>>([]);
  const [products, setProducts] = useState<QuoteFormProduct[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void fetchQuoteFormOptions()
      .then((opts) => {
        if (cancelled || !opts.ok) return;
        setDeals(opts.deals);
        setProducts(opts.products);
        // Never silently default to the first catalog deal/product — an
        // unset draft must stay unset until the user (or a validated chat
        // patch) actually picks one. Auto-filling here made quote_draft_ready
        // (and this panel's progress %) look "complete" before anything was
        // really chosen, so the wrong product could get quoted/saved.
        const initial = emptyQuoteDraft(draft);
        initial.dealId = opts.deals.some((d) => d.id === initialDealId)
          ? initialDealId
          : opts.deals.some((d) => d.id === draft.dealId)
            ? draft.dealId
            : "";
        initial.productId = opts.products.some((p) => p.id === draft.productId)
          ? draft.productId
          : "";
        const selected =
          opts.products.find((p) => p.id === initial.productId) ?? null;
        if (
          selected?.productType === "customizable" &&
          selected.offers.length > 0
        ) {
          initial.offerId = selected.offers.some((o) => o.id === draft.offerId)
            ? draft.offerId
            : "";
        } else {
          initial.offerId = "";
          initial.addonQuantities = {};
        }
        onDraftChange(initial);
      })
      .catch(() => setError("Failed to load form options."))
      .finally(() => {
        if (!cancelled) setOptsReady(true);
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- init defaults once
  }, []);

  const selectedProduct = useMemo(
    () => products.find((p) => p.id === draft.productId) ?? null,
    [products, draft.productId],
  );

  const needsOffer =
    selectedProduct?.productType === "customizable" &&
    (selectedProduct.offers.length ?? 0) > 0;

  const selectedOffer = useMemo(
    () => selectedProduct?.offers.find((o) => o.id === draft.offerId) ?? null,
    [selectedProduct, draft.offerId],
  );

  const progress = requiredProgress([
    Boolean(draft.dealId),
    Boolean(draft.productId),
    !needsOffer || Boolean(draft.offerId),
    Number(draft.quantity) > 0,
  ]);

  const built = useMemo(() => {
    if (!selectedProduct) return null;
    return buildQuoteLines({
      product: selectedProduct,
      quantity: Number.parseFloat(draft.quantity) || 0,
      offerId: draft.offerId,
      addonQuantities: toAddonQuantities(draft),
    });
  }, [selectedProduct, draft]);

  const estimated = useMemo(() => {
    if (!built || built.error || built.lines.length === 0) return null;
    return {
      total: estimateQuoteTotal(built.lines, draft.discountPct),
      currency: built.currency,
      lineCount: built.lines.length,
    };
  }, [built, draft.discountPct]);

  const applyPatch = useCallback(
    (patch: Partial<QuoteDraftFields>) => {
      const next: QuoteDraftFields = {
        ...draft,
        ...patch,
        addonQuantities: {
          ...(draft.addonQuantities ?? {}),
          ...(patch.addonQuantities ?? {}),
        },
      };
      if (patch.dealId && !deals.some((d) => d.id === patch.dealId)) {
        const match = deals.find(
          (d) => d.title.toLowerCase() === (patch.dealId ?? "").toLowerCase(),
        );
        if (match?.id) {
          next.dealId = match.id;
        } else if (deals.length === 0) {
          // Catalog still loading — keep the id from chat; wiping it here is
          // what made soft-confirm "yes" look like the deal vanished.
          next.dealId = patch.dealId;
        } else {
          next.dealId = "";
        }
      }
      if (patch.productId && !products.some((p) => p.id === patch.productId)) {
        const wanted = (patch.productId ?? "").toLowerCase();
        const match = products.find(
          (p) => p.name.toLowerCase() === wanted || p.sku?.toLowerCase() === wanted,
        );
        if (match?.id) {
          next.productId = match.id;
        } else if (products.length === 0) {
          next.productId = patch.productId;
        } else {
          next.productId = "";
        }
      }
      if (patch.productId && patch.productId !== draft.productId) {
        const product = products.find((p) => p.id === next.productId);
        if (product?.productType !== "customizable" || !product.offers.length) {
          next.offerId = "";
          next.addonQuantities = {};
        }
      }
      onDraftChange(next);
    },
    [deals, draft, onDraftChange, products],
  );

  useEffect(() => {
    if (!patchRef) return;
    patchRef.current = applyPatch;
    return () => {
      patchRef.current = null;
    };
  }, [applyPatch, patchRef]);

  const doCreate = useCallback(async (): Promise<true | string> => {
    if (!optsReady) {
      const msg = "Quote form is still loading — try again in a moment.";
      setError(msg);
      return msg;
    }
    if (!progress.ready || !selectedProduct) {
      const msg = needsOffer
        ? "Select a deal, product, plan / offer, and quantity."
        : "Select a deal, product, and quantity.";
      setError(msg);
      return msg;
    }
    const resultBuild = buildQuoteLines({
      product: selectedProduct,
      quantity: Number.parseFloat(draft.quantity) || 0,
      offerId: draft.offerId,
      addonQuantities: toAddonQuantities(draft),
    });
    if (resultBuild.error) {
      setError(resultBuild.error);
      return resultBuild.error;
    }
    if (!resultBuild.lines.length) {
      const msg = "Add at least one priced line before creating the quote.";
      setError(msg);
      return msg;
    }
    setSaving(true);
    setError(null);
    try {
      const result = await createQuote({
        dealId: draft.dealId,
        discountPct: Number.parseFloat(draft.discountPct) || 0,
        currency: resultBuild.currency,
        fromTemplate: true,
        lines: resultBuild.lines,
      });
      if (!result.ok) {
        setError(result.error);
        return result.error || "Couldn't create quote.";
      }
      onCreated(result.id);
      return true;
    } catch (err) {
      const msg =
        err instanceof Error && err.message.trim()
          ? err.message.trim()
          : "Couldn't create quote.";
      setError(msg);
      return msg;
    } finally {
      setSaving(false);
    }
  }, [draft, needsOffer, onCreated, optsReady, progress.ready, selectedProduct]);

  useEffect(() => {
    if (!submitRef) return;
    submitRef.current = () => doCreate();
    return () => {
      submitRef.current = null;
    };
  }, [doCreate, submitRef]);

  const onProductChange = (productId: string) => {
    const product = products.find((p) => p.id === productId);
    onDraftChange({
      ...draft,
      productId,
      quantity: draft.quantity && Number(draft.quantity) > 0 ? draft.quantity : "1",
      offerId:
        product?.productType === "customizable" && product.offers[0]
          ? product.offers[0].id
          : "",
      addonQuantities: {},
    });
  };

  const toggleAddon = (addonId: string, checked: boolean) => {
    const next = { ...(draft.addonQuantities ?? {}) };
    if (checked) next[addonId] = next[addonId] && Number(next[addonId]) > 0 ? next[addonId] : "1";
    else delete next[addonId];
    onDraftChange({ ...draft, addonQuantities: next });
  };

  const setAddonQty = (addonId: string, qty: string) => {
    onDraftChange({
      ...draft,
      addonQuantities: { ...(draft.addonQuantities ?? {}), [addonId]: qty },
    });
  };

  if (optsReady && deals.length === 0) {
    return (
      <div className="p-4 text-center text-sm text-text-caption">
        Create a deal first, then add quotes.
        {onCancel ? (
          <div className="mt-3">
            <Button type="button" variant="secondary" onClick={onCancel}>
              <ArrowLeft className="size-4" strokeWidth={1.75} />
              Back to list
            </Button>
          </div>
        ) : null}
      </div>
    );
  }

  const guidedSteps = useMemo(() => {
    const defs = quoteSetupSteps(
      (id) => deals.find((d) => d.id === id)?.title ?? null,
      (id) => products.find((p) => p.id === id)?.name ?? null,
      (id) => {
        for (const p of products) {
          const offer = p.offers.find((o) => o.id === id);
          if (offer) return offer.name;
        }
        return null;
      },
    );
    return resolveSetupSteps(defs, draft);
  }, [deals, draft, products]);

  const quantityLabel = (() => {
    if (!selectedProduct) return "Quantity";
    if (!needsOffer) return "Quantity";
    const meter = selectedOffer?.meterKey;
    if (meter === "seat" || meter === "agent") return "Quantity (seats / agents)";
    if (meter === "minute") return "Quantity (minute packs)";
    if (meter === "session") return "Quantity (session packs)";
    return "Quantity (offer units)";
  })();

  if (mode === "guided") {
    return (
      <GuidedSetupPanel
        setupTitle="Quote setup"
        headline={quoteSetupHeadline(draft)}
        steps={guidedSteps}
        error={error}
        onCancel={onCancel}
      />
    );
  }

  return (
    <DraftPanelFrame>
      <CoworkerDraftPanel
        title="Quote draft"
        progressLabel={`${progress.filled}/${progress.total} ready`}
        progressRatio={progress.ratio}
        footer={
          <>
            <Button
              type="button"
              variant="primary"
              disabled={saving || !progress.ready}
              onClick={() => void doCreate()}
            >
              {saving ? "Creating…" : "Create quote"}
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
                  { value: "", label: "Select deal…" },
                  ...deals.map((d) => ({ value: d.id, label: d.title })),
                ]
          }
        />
        <Select
          label="Product"
          required
          value={draft.productId}
          onChange={(e) => onProductChange(e.target.value)}
          options={
            !optsReady && products.length === 0
              ? [{ value: "", label: "Loading products…" }]
              : [
                  { value: "", label: "Select product…" },
                  ...products.map((p) => ({
                    value: p.id,
                    label: `${p.name}${priceLabel(
                      p.listPrice ?? p.basePrice,
                      p.currency,
                    )}`,
                  })),
                ]
          }
        />

        {needsOffer ? (
          <Select
            label="Plan / offer"
            required
            value={draft.offerId}
            onChange={(e) =>
              onDraftChange({ ...draft, offerId: e.target.value })
            }
            options={[
              { value: "", label: "Select plan…" },
              ...(selectedProduct?.offers.map((o) => ({
                value: o.id,
                label: `${o.name}${priceLabel(o.listPrice, o.currency)}`,
              })) ?? []),
            ]}
          />
        ) : null}

        <Input
          label={quantityLabel}
          type="number"
          min={1}
          step="1"
          required
          value={draft.quantity}
          onChange={(e) =>
            onDraftChange({ ...draft, quantity: e.target.value })
          }
        />

        {selectedProduct?.productType === "customizable" &&
        selectedProduct.addons.length > 0 ? (
          <div className="space-y-3">
            <p className="text-xs font-medium text-text-caption">
              Addons (set how many agents, minutes, sessions, etc.)
            </p>
            {selectedProduct.addons.map((addon) => {
              const selected = (draft.addonQuantities ?? {})[addon.id] != null;
              const qty = (draft.addonQuantities ?? {})[addon.id] ?? "1";
              const unpriced =
                addon.pricingModel !== "tiered" &&
                addon.listPrice == null &&
                addon.flatPrice == null &&
                addon.unitPrice == null &&
                addon.stepPrice == null;
              return (
                <div
                  key={addon.id}
                  className="rounded-lg border border-border-default p-3"
                >
                  <Checkbox
                    id={`quote-addon-${addon.id}`}
                    checked={selected}
                    disabled={unpriced}
                    onChange={(e) => toggleAddon(addon.id, e.target.checked)}
                    label={`${addon.name}${
                      unpriced
                        ? " (no price)"
                        : priceLabel(addon.listPrice, addon.currency)
                    }${addon.isOverage ? " · overage" : ""}`}
                  />
                      {selected ? (
                      <div className="mt-2 pl-6">
                        <Input
                          label={`Qty (${addonUnitHint(addon)})`}
                          type="number"
                          min={1}
                          step={addon.pricingModel === "flat" ? 1 : "any"}
                          value={qty}
                          onChange={(e) => setAddonQty(addon.id, e.target.value)}
                        />
                      </div>
                    ) : null}
                </div>
              );
            })}
          </div>
        ) : null}

        <Input
          label="Discount %"
          type="number"
          min={0}
          max={100}
          step="0.1"
          value={draft.discountPct}
          onChange={(e) =>
            onDraftChange({ ...draft, discountPct: e.target.value })
          }
        />

        {estimated ? (
          <p className="text-sm text-text-secondary">
            Estimated total:{" "}
            <span className="font-semibold text-text-primary">
              {formatMoney(estimated.total, estimated.currency)}
            </span>
            {estimated.lineCount > 1
              ? ` · ${estimated.lineCount} lines`
              : null}
          </p>
        ) : built?.error ? (
          <p className="text-sm text-text-danger">{built.error}</p>
        ) : null}

        {error ? <p className="text-sm text-text-danger">{error}</p> : null}
      </CoworkerDraftPanel>
    </DraftPanelFrame>
  );
}
