import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type MutableRefObject,
} from "react";
import { ArrowLeft } from "lucide-react";
import { CoworkerDraftPanel, DraftPanelFrame } from "@/components/coworker/CoworkerCreateShell";
import { GuidedSetupPanel } from "@/components/coworker/GuidedSetupPanel";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Select } from "@/components/ui/Select";
import { Textarea } from "@/components/ui/Textarea";
import { productInputFromDraft, productShowsQuoteFields, productShowsRetailFields } from "@/lib/coworker/field-contracts/product";
import { requiredProgress } from "@/lib/coworker/draft-progress";
import {
  productSetupHeadline,
  productSetupSteps,
  resolveSetupSteps,
} from "@/lib/coworker/guided-setup-steps";
import type { ProductDraftFields } from "@/services/coworker";
import { createProduct } from "@/services/products";
import { useAppSelector } from "@/store";

const STATUS_OPTIONS = [
  { value: "draft", label: "Draft" },
  { value: "active", label: "Active" },
  { value: "archived", label: "Archived" },
];

const TYPE_OPTIONS = [
  { value: "fixed", label: "Fixed price" },
  { value: "customizable", label: "Customizable" },
];

const CURRENCY_OPTIONS = [
  { value: "", label: "Tenant default" },
  { value: "USD", label: "USD" },
  { value: "EUR", label: "EUR" },
  { value: "GBP", label: "GBP" },
  { value: "INR", label: "INR" },
  { value: "AED", label: "AED" },
];

const BILLING_TYPE_OPTIONS = [
  { value: "one_time", label: "One-time" },
  { value: "recurring", label: "Recurring" },
];

const BILLING_FREQUENCY_OPTIONS = [
  { value: "monthly", label: "Monthly" },
  { value: "quarterly", label: "Quarterly" },
  { value: "annual", label: "Annual" },
];

const PRICING_MODEL_OPTIONS = [
  { value: "unit", label: "Unit" },
  { value: "flat", label: "Flat" },
  { value: "tiered", label: "Tiered" },
  { value: "step", label: "Step" },
];

export function emptyProductDraft(
  partial?: Partial<ProductDraftFields>,
): ProductDraftFields {
  return {
    name: "",
    sku: "",
    brand: "",
    category: "",
    subcategory: "",
    stockOnHand: "",
    productUrl: "",
    description: "",
    // Leave commercial defaults unset so guided setup doesn't mark them
    // "completed" before the user/agent fills them. Submit still applies
    // fixed / one_time / USD via productInputFromDraft.
    price: "",
    maxDiscountPercent: "",
    currency: "",
    status: "",
    active: false,
    productType: "",
    billingType: "",
    billingFrequency: "",
    tags: "",
    imageUrl: "",
    galleryUrls: "",
    offers: [],
    addons: [],
    skippedOptional: "",
    ...partial,
  };
}

export type ProductCreateDraftPanelProps = {
  draft: ProductDraftFields;
  onDraftChange: (next: ProductDraftFields) => void;
  onCreated: (productId: string) => void;
  onCancel?: () => void;
  patchRef?: MutableRefObject<
    ((patch: Partial<ProductDraftFields>) => void) | null
  >;
  submitRef?: MutableRefObject<(() => Promise<true | string>) | null>;
  mode?: "guided" | "form";
};

export function ProductCreateDraftPanel({
  draft,
  onDraftChange,
  onCreated,
  onCancel,
  patchRef,
  submitRef,
  mode = "guided",
}: ProductCreateDraftPanelProps) {
  const businessType = useAppSelector((s) => s.auth.user?.businessType) ?? "b2b";
  const showRetailFields = productShowsRetailFields(businessType);
  const showQuoteFields = productShowsQuoteFields(businessType);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const liveDraftRef = useRef(draft);
  liveDraftRef.current = draft;

  const applyPatch = useCallback(
    (patch: Partial<ProductDraftFields>) => {
      const prev = liveDraftRef.current;
      const next = {
        ...prev,
        ...patch,
        offers: patch.offers ?? prev.offers,
        addons: patch.addons ?? prev.addons,
      };
      liveDraftRef.current = next;
      onDraftChange(next);
    },
    [onDraftChange],
  );

  useEffect(() => {
    if (!patchRef) return;
    patchRef.current = applyPatch;
    return () => {
      patchRef.current = null;
    };
  }, [applyPatch, patchRef]);

  const progress = requiredProgress([
    Boolean(draft.name.trim()),
    Boolean(draft.sku.trim()),
  ]);

  const doCreate = async (): Promise<true | string> => {
    if (!progress.ready) {
      const msg = "Name and SKU are required.";
      setError(msg);
      return msg;
    }
    setSaving(true);
    setError(null);
    const body = productInputFromDraft({
      ...draft,
      productType: showQuoteFields ? draft.productType : "fixed",
      billingType: showQuoteFields ? draft.billingType : "one_time",
    });
    const result = await createProduct(body as Parameters<typeof createProduct>[0]);
    setSaving(false);
    if (!result.ok) {
      setError(result.error);
      return result.error || "Couldn't create product.";
    }
    onCreated(result.id);
    return true;
  };

  const requestCreate = useCallback((): Promise<true | string> => {
    if (!progress.ready) {
      const missing: string[] = [];
      if (!draft.name.trim()) missing.push("name");
      if (!draft.sku.trim()) missing.push("SKU");
      const msg =
        missing.length > 0
          ? `Still need ${missing.join(" and ")} before I can save.`
          : "Name and SKU are required.";
      setError(msg);
      return Promise.resolve(msg);
    }
    return doCreate();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- doCreate closes over latest draft
  }, [progress.ready, draft]);

  useEffect(() => {
    if (!submitRef) return;
    submitRef.current = requestCreate;
    return () => {
      submitRef.current = null;
    };
  }, [requestCreate, submitRef]);

  const guidedSteps = useMemo(() => {
    const steps = productSetupSteps.filter((s) => {
      if (
        !showQuoteFields &&
        ["productType", "maxDiscount", "billingType", "offers", "addons"].includes(
          s.id,
        )
      ) {
        return false;
      }
      if (!showRetailFields && (s.id === "brand" || s.id === "stockOnHand")) {
        return false;
      }
      return true;
    });
    return resolveSetupSteps(steps, draft);
  }, [draft, showQuoteFields, showRetailFields]);

  if (mode === "guided") {
    return (
      <GuidedSetupPanel
        setupTitle="Product setup"
        headline={productSetupHeadline(draft)}
        steps={guidedSteps}
        error={error}
        onCancel={onCancel}
      />
    );
  }

  return (
    <DraftPanelFrame>
      <CoworkerDraftPanel
        title="Product draft"
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
              {saving ? "Creating…" : "Create product"}
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
        <div className="grid gap-3 sm:grid-cols-2">
          <Input
            label="Product name"
            required
            placeholder="Pro Plan"
            value={draft.name}
            onChange={(e) => onDraftChange({ ...draft, name: e.target.value })}
          />
          <Input
            label="SKU"
            required
            placeholder="PRO-1"
            value={draft.sku}
            onChange={(e) => onDraftChange({ ...draft, sku: e.target.value })}
          />
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <Select
            label="Status"
            value={draft.status || "draft"}
            onChange={(e) =>
              onDraftChange({ ...draft, status: e.target.value })
            }
            options={STATUS_OPTIONS}
          />
          {showQuoteFields ? (
            <Select
              label="Product type"
              value={draft.productType || "fixed"}
              onChange={(e) =>
                onDraftChange({ ...draft, productType: e.target.value })
              }
              options={TYPE_OPTIONS}
            />
          ) : (
            <Input
              label="Category"
              value={draft.category}
              onChange={(e) =>
                onDraftChange({ ...draft, category: e.target.value })
              }
            />
          )}
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          {showRetailFields ? (
            <Input
              label="Brand"
              value={draft.brand}
              onChange={(e) =>
                onDraftChange({ ...draft, brand: e.target.value })
              }
            />
          ) : null}
          <Input
            label="Subcategory"
            value={draft.subcategory}
            onChange={(e) =>
              onDraftChange({ ...draft, subcategory: e.target.value })
            }
          />
        </div>
        {showQuoteFields ? (
          <>
            <div className="grid gap-3 sm:grid-cols-2">
              <Select
                label="Billing type"
                value={draft.billingType || "one_time"}
                onChange={(e) =>
                  onDraftChange({
                    ...draft,
                    billingType: e.target.value,
                    billingFrequency:
                      e.target.value === "recurring"
                        ? draft.billingFrequency || "monthly"
                        : draft.billingFrequency,
                  })
                }
                options={BILLING_TYPE_OPTIONS}
              />
              {draft.billingType === "recurring" ? (
                <Select
                  label="Billing frequency"
                  value={draft.billingFrequency || "monthly"}
                  onChange={(e) =>
                    onDraftChange({
                      ...draft,
                      billingFrequency: e.target.value,
                    })
                  }
                  options={BILLING_FREQUENCY_OPTIONS}
                />
              ) : (
                <Input
                  label="Category"
                  value={draft.category}
                  onChange={(e) =>
                    onDraftChange({ ...draft, category: e.target.value })
                  }
                />
              )}
            </div>
            {draft.billingType === "recurring" ? (
              <Input
                label="Category"
                value={draft.category}
                onChange={(e) =>
                  onDraftChange({ ...draft, category: e.target.value })
                }
              />
            ) : null}
            <Textarea
              label="Description"
              value={draft.description}
              onChange={(e) =>
                onDraftChange({ ...draft, description: e.target.value })
              }
            />
            <Input
              label="Tags"
              value={draft.tags}
              onChange={(e) => onDraftChange({ ...draft, tags: e.target.value })}
              placeholder="ccaas, platform"
            />
            <div className="grid gap-3 sm:grid-cols-2">
              <Input
                label="Image URL"
                value={draft.imageUrl}
                onChange={(e) =>
                  onDraftChange({ ...draft, imageUrl: e.target.value })
                }
              />
              <Input
                label="Max discount %"
                type="number"
                min={0}
                max={100}
                step="0.01"
                value={draft.maxDiscountPercent}
                onChange={(e) =>
                  onDraftChange({
                    ...draft,
                    maxDiscountPercent: e.target.value,
                  })
                }
              />
            </div>
            <Textarea
              label="Gallery URLs (one per line)"
              value={draft.galleryUrls}
              onChange={(e) =>
                onDraftChange({ ...draft, galleryUrls: e.target.value })
              }
            />
            {draft.productType === "customizable" ? (
              <div className="space-y-3 rounded-lg border border-border-default p-3">
                <div className="flex items-center justify-between gap-2">
                  <p className="text-sm font-medium text-text-primary">Offers / plans</p>
                  <Button
                    type="button"
                    variant="secondary"
                    className="h-8 px-2 text-xs"
                    onClick={() =>
                      onDraftChange({
                        ...draft,
                        offers: [
                          ...draft.offers,
                          { name: "", code: "", includedQty: "", meterKey: "" },
                        ],
                      })
                    }
                  >
                    Add offer
                  </Button>
                </div>
                {draft.offers.map((offer, idx) => (
                  <div key={idx} className="grid gap-2 sm:grid-cols-2">
                    <Input
                      label="Offer name"
                      value={offer.name}
                      onChange={(e) => {
                        const offers = draft.offers.slice();
                        offers[idx] = { ...offer, name: e.target.value };
                        onDraftChange({ ...draft, offers });
                      }}
                    />
                    <Input
                      label="Code"
                      value={offer.code ?? ""}
                      onChange={(e) => {
                        const offers = draft.offers.slice();
                        offers[idx] = { ...offer, code: e.target.value };
                        onDraftChange({ ...draft, offers });
                      }}
                    />
                    <Input
                      label="Included qty"
                      value={offer.includedQty ?? ""}
                      onChange={(e) => {
                        const offers = draft.offers.slice();
                        offers[idx] = { ...offer, includedQty: e.target.value };
                        onDraftChange({ ...draft, offers });
                      }}
                    />
                    <Input
                      label="Meter key"
                      value={offer.meterKey ?? ""}
                      onChange={(e) => {
                        const offers = draft.offers.slice();
                        offers[idx] = { ...offer, meterKey: e.target.value };
                        onDraftChange({ ...draft, offers });
                      }}
                    />
                  </div>
                ))}
                <div className="flex items-center justify-between gap-2 pt-2">
                  <p className="text-sm font-medium text-text-primary">Addons</p>
                  <Button
                    type="button"
                    variant="secondary"
                    className="h-8 px-2 text-xs"
                    onClick={() =>
                      onDraftChange({
                        ...draft,
                        addons: [
                          ...draft.addons,
                          {
                            name: "",
                            pricingModel: "unit",
                            unitPrice: "",
                            unitLabel: "",
                          },
                        ],
                      })
                    }
                  >
                    Add addon
                  </Button>
                </div>
                {draft.addons.map((addon, idx) => (
                  <div key={idx} className="grid gap-2 sm:grid-cols-2">
                    <Input
                      label="Addon name"
                      value={addon.name}
                      onChange={(e) => {
                        const addons = draft.addons.slice();
                        addons[idx] = { ...addon, name: e.target.value };
                        onDraftChange({ ...draft, addons });
                      }}
                    />
                    <Select
                      label="Pricing model"
                      value={addon.pricingModel}
                      onChange={(e) => {
                        const addons = draft.addons.slice();
                        addons[idx] = { ...addon, pricingModel: e.target.value };
                        onDraftChange({ ...draft, addons });
                      }}
                      options={PRICING_MODEL_OPTIONS}
                    />
                    <Input
                      label="Unit price"
                      value={addon.unitPrice ?? ""}
                      onChange={(e) => {
                        const addons = draft.addons.slice();
                        addons[idx] = { ...addon, unitPrice: e.target.value };
                        onDraftChange({ ...draft, addons });
                      }}
                    />
                    <Input
                      label="Unit label"
                      value={addon.unitLabel ?? ""}
                      onChange={(e) => {
                        const addons = draft.addons.slice();
                        addons[idx] = { ...addon, unitLabel: e.target.value };
                        onDraftChange({ ...draft, addons });
                      }}
                    />
                  </div>
                ))}
              </div>
            ) : null}
          </>
        ) : null}
        <div className="grid gap-3 sm:grid-cols-2">
          <Input
            label="Price"
            type="number"
            min={0}
            step="0.01"
            value={draft.price}
            onChange={(e) => onDraftChange({ ...draft, price: e.target.value })}
          />
          <Select
            label="Currency"
            value={draft.currency || ""}
            onChange={(e) =>
              onDraftChange({ ...draft, currency: e.target.value })
            }
            options={CURRENCY_OPTIONS}
          />
          {showRetailFields ? (
            <Input
              label="Stock on hand"
              type="number"
              min={0}
              step="1"
              value={draft.stockOnHand}
              onChange={(e) =>
                onDraftChange({ ...draft, stockOnHand: e.target.value })
              }
              placeholder="50"
            />
          ) : null}
          <Input
            label="Product URL"
            value={draft.productUrl}
            onChange={(e) =>
              onDraftChange({ ...draft, productUrl: e.target.value })
            }
            placeholder="https://…"
          />
        </div>
        {error ? <p className="text-sm text-text-danger">{error}</p> : null}
      </CoworkerDraftPanel>
    </DraftPanelFrame>
  );
}
