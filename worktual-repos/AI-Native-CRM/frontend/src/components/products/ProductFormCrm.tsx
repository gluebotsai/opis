import { useMemo, useState, type ReactNode } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Plus, Trash2 } from "lucide-react";
import {
  formatAddonAmount,
  priceAddon,
  type AddonPricingModel,
} from "@/lib/addon-pricing";
import { Button } from "@/components/ui/Button";
import { Checkbox } from "@/components/ui/Checkbox";
import { Input } from "@/components/ui/Input";
import { Select } from "@/components/ui/Select";
import { Textarea } from "@/components/ui/Textarea";
import {
  createProduct,
  updateProduct,
  type ProductDetail,
} from "@/services/products";
import { productShowsQuoteFields, productShowsRetailFields } from "@/lib/coworker/field-contracts/product";
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
  { value: "flat", label: "Flat" },
  { value: "per_unit", label: "Per unit" },
  { value: "stepped", label: "Stepped (packs)" },
  { value: "tiered", label: "Tiered" },
];

const METER_KEY_OPTIONS = [
  { value: "", label: "None" },
  { value: "seat", label: "Seat" },
  { value: "minute", label: "Minute" },
  { value: "session", label: "Session" },
  { value: "email", label: "Email" },
  { value: "agent", label: "Agent" },
  { value: "flat", label: "Flat" },
  { value: "custom", label: "Custom" },
];

const OFFER_STATUS_OPTIONS = [
  { value: "active", label: "Active" },
  { value: "draft", label: "Draft" },
  { value: "archived", label: "Archived" },
];

function Section({
  title,
  description,
  children,
}: {
  title: string;
  description?: string;
  children: ReactNode;
}) {
  return (
    <section className="rounded-xl border border-border-default bg-surface p-5 sm:p-6">
      <h2 className="text-base font-semibold tracking-tight text-text-primary">
        {title}
      </h2>
      {description ? (
        <p className="mt-1 text-sm leading-5 text-text-caption">{description}</p>
      ) : null}
      <div className="mt-5 grid gap-4">{children}</div>
    </section>
  );
}

type TierDraft = {
  minQty: string;
  maxQty: string;
  unitPrice: string;
};

type AddonDraft = {
  key: string;
  name: string;
  unitLabel: string;
  meterKey: string;
  isOverage: boolean;
  pricingModel: AddonPricingModel;
  flatPrice: string;
  unitPrice: string;
  stepSize: string;
  stepPrice: string;
  previewQty: string;
  tiers: TierDraft[];
};

type OfferDraft = {
  key: string;
  name: string;
  code: string;
  includedQty: string;
  meterKey: string;
  status: string;
};


function emptyAddon(): AddonDraft {
  return {
    key: `new-${Math.random().toString(36).slice(2, 9)}`,
    name: "",
    unitLabel: "",
    meterKey: "",
    isOverage: false,
    pricingModel: "per_unit",
    flatPrice: "",
    unitPrice: "",
    stepSize: "",
    stepPrice: "",
    previewQty: "1",
    tiers: [{ minQty: "1", maxQty: "", unitPrice: "" }],
  };
}

function emptyOffer(): OfferDraft {
  return {
    key: `offer-${Math.random().toString(36).slice(2, 9)}`,
    name: "",
    code: "",
    includedQty: "",
    meterKey: "",
    status: "active",
  };
}


function addonFromView(
  addon: NonNullable<ProductDetail["addons"]>[number],
): AddonDraft {
  return {
    key: addon.id,
    name: addon.name,
    unitLabel: addon.unitLabel ?? "",
    meterKey: addon.meterKey ?? "",
    isOverage: Boolean(addon.isOverage),
    pricingModel: addon.pricingModel as AddonPricingModel,
    flatPrice: addon.flatPrice ?? "",
    unitPrice: addon.unitPrice ?? "",
    stepSize: addon.stepSize != null ? String(addon.stepSize) : "",
    stepPrice: addon.stepPrice ?? "",
    previewQty: "10",
    tiers: addon.tiers.length
      ? addon.tiers.map((t: { minQty: number; maxQty: number | null; unitPrice: string }) => ({
          minQty: String(t.minQty),
          maxQty: t.maxQty != null ? String(t.maxQty) : "",
          unitPrice: t.unitPrice,
        }))
      : [{ minQty: "1", maxQty: "", unitPrice: "" }],
  };
}

function numOrNull(raw: string): number | null {
  const t = raw.trim();
  if (!t) return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
}

export function ProductFormCrm({
  mode,
  product,
}: {
  mode?: "create" | "edit";
  product?: ProductDetail | null;
}) {
  const navigate = useNavigate();
  const businessType = useAppSelector((s) => s.auth.user?.businessType) ?? "b2b";
  const isB2c = businessType === "b2c";
  const showRetailFields = productShowsRetailFields(businessType);
  const showQuoteFields = productShowsQuoteFields(businessType);
  const resolvedMode = mode ?? (product?.id ? "edit" : "create");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  const [name, setName] = useState(product?.name ?? "");
  const [sku, setSku] = useState(product?.sku ?? "");
  const [status, setStatus] = useState(product?.status ?? "draft");
  const [productType, setProductType] = useState(
    product?.productType ?? "fixed",
  );
  const [category, setCategory] = useState(product?.category ?? "");
  const [brand, setBrand] = useState(product?.brand ?? "");
  const [subcategory, setSubcategory] = useState(product?.subcategory ?? "");
  const [stockOnHand, setStockOnHand] = useState(
    product?.stockOnHand != null ? String(product.stockOnHand) : "",
  );
  const [tags, setTags] = useState(product?.tags ?? "");
  const [price, setPrice] = useState(product?.price ?? "");
  const [maxDiscountPercent, setMaxDiscountPercent] = useState(
    product?.maxDiscountPercent ?? "",
  );
  const [currency, setCurrency] = useState(product?.currency ?? "");
  const [billingType, setBillingType] = useState(
    product?.billingType ?? "one_time",
  );
  const [billingFrequency, setBillingFrequency] = useState(
    product?.billingFrequency ?? "monthly",
  );
  const [imageUrl, setImageUrl] = useState(product?.imageUrl ?? "");
  const [galleryUrls, setGalleryUrls] = useState(
    product?.galleryUrls?.join("\n") ?? "",
  );
  const [productUrl, setProductUrl] = useState(product?.productUrl ?? "");

  const descriptionDefault = useMemo(() => {
    const parts = [product?.description, product?.specifications].filter(
      Boolean,
    );
    return parts.join("\n\n");
  }, [product?.description, product?.specifications]);
  const [description, setDescription] = useState(descriptionDefault);

  const [addons, setAddons] = useState<AddonDraft[]>(() =>
    product?.addons?.length ? product.addons.map(addonFromView) : [],
  );
  const [offers, setOffers] = useState<OfferDraft[]>(() =>
    product?.offers?.length
      ? product.offers.map((o) => ({
          key: o.id,
          name: o.name,
          code: o.code ?? "",
          includedQty: o.includedQty != null ? String(o.includedQty) : "",
          meterKey: o.meterKey ?? "",
          status: o.status ?? "active",
        }))
      : [],
  );

  function updateAddon(key: string, patch: Partial<AddonDraft>) {
    setAddons((prev) =>
      prev.map((a) => (a.key === key ? { ...a, ...patch } : a)),
    );
  }

  function updateOffer(key: string, patch: Partial<OfferDraft>) {
    setOffers((prev) =>
      prev.map((o) => (o.key === key ? { ...o, ...patch } : o)),
    );
  }

  function buildAddonsPayload() {
    return addons.map((addon, index) => ({
      name: addon.name,
      unitLabel: addon.unitLabel || null,
      meterKey: addon.meterKey || null,
      isOverage: addon.isOverage,
      pricingModel: addon.pricingModel,
      flatPrice: numOrNull(addon.flatPrice),
      unitPrice: numOrNull(addon.unitPrice),
      stepSize: numOrNull(addon.stepSize),
      stepPrice: numOrNull(addon.stepPrice),
      sortOrder: index,
      tiers: addon.tiers.map((t) => ({
        minQty: Number(t.minQty),
        maxQty: t.maxQty.trim() ? Number(t.maxQty) : null,
        unitPrice: Number(t.unitPrice),
      })),
    }));
  }

  function buildOffersPayload() {
    return offers.map((offer, index) => ({
      name: offer.name,
      code: offer.code || null,
      includedQty: numOrNull(offer.includedQty),
      meterKey: offer.meterKey || null,
      status: offer.status || "active",
      sortOrder: index,
    }));
  }

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);

    const stockRaw = stockOnHand.trim();
    const stockParsed = stockRaw ? Number.parseInt(stockRaw, 10) : null;
    if (stockRaw && (!Number.isInteger(stockParsed) || (stockParsed ?? -1) < 0)) {
      setError("Stock on hand must be a whole number ≥ 0.");
      return;
    }

    setPending(true);

    const priceNum = price.trim() ? Number(price) : null;
    const maxDiscountNum = maxDiscountPercent.trim()
      ? Number(maxDiscountPercent)
      : null;
    const effectiveType = showQuoteFields ? productType : "fixed";
    const effectiveBilling = showQuoteFields ? billingType : "one_time";
    const body = {
      name,
      sku,
      description: description || null,
      specifications: null,
      imageUrl: imageUrl || null,
      galleryUrls: galleryUrls
        .split("\n")
        .map((u) => u.trim())
        .filter(Boolean),
      productUrl: productUrl.trim() || null,
      price: priceNum != null && Number.isFinite(priceNum) ? priceNum : null,
      maxDiscountPercent:
        !showQuoteFields || maxDiscountNum == null || !Number.isFinite(maxDiscountNum)
          ? null
          : maxDiscountNum,
      currency,
      status,
      productType: effectiveType,
      category: category || null,
      brand: brand || null,
      subcategory: subcategory || null,
      stockOnHand: stockParsed,
      tags: tags || null,
      billingType: effectiveBilling,
      billingFrequency:
        effectiveBilling === "recurring" ? billingFrequency : null,
      addons: effectiveType === "customizable" ? buildAddonsPayload() : [],
      offers: effectiveType === "customizable" ? buildOffersPayload() : [],
    };

    const result =
      resolvedMode === "create"
        ? await createProduct(body)
        : await updateProduct(product!.id, body);
    setPending(false);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    navigate(`/product/${result.id}`);
  }

  return (
    <form onSubmit={onSubmit} className="space-y-6 pb-2">
      <div className="mb-1">
        <h1 className="text-xl font-semibold tracking-tight text-text-primary">
          {resolvedMode === "create" ? "New product" : "Edit product"}
        </h1>
        <p className="mt-2 text-sm leading-5 text-text-caption">
          {resolvedMode === "create"
            ? "Add catalog details for quotes and invoices."
            : "Update catalog identity, pricing, and addons."}
        </p>
      </div>
      <Section
        title="Product details"
        description="Catalog identity for quotes and invoices."
      >
        <div className="grid gap-4 sm:grid-cols-2">
          <Input
            label="Name"
            required
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder={isB2c ? "Pulse Wireless Earbuds" : "CCaaS Platform"}
          />
          <Input
            label="SKU"
            required
            value={sku}
            onChange={(e) => setSku(e.target.value)}
            placeholder={isB2c ? "WT-EARBUD-BLK" : "CCAAS-01"}
          />
          <Select
            label="Status"
            value={status}
            onChange={(e) => setStatus(e.target.value)}
            options={STATUS_OPTIONS}
          />
          {showQuoteFields ? (
            <Select
              label="Product type"
              value={productType}
              onChange={(e) => {
                const next = e.target.value;
                setProductType(next);
                if (next === "fixed") {
                  setAddons([]);
                  setOffers([]);
                }
              }}
              options={TYPE_OPTIONS}
            />
          ) : null}
          <Input
            label="Category"
            value={category}
            onChange={(e) => setCategory(e.target.value)}
            placeholder={isB2c ? "Audio" : "Communications"}
          />
          {showRetailFields ? (
            <Input
              label="Brand"
              value={brand}
              onChange={(e) => setBrand(e.target.value)}
              placeholder={isB2c ? "Worktual Home" : "Acme"}
            />
          ) : null}
          <Input
            label="Subcategory"
            value={subcategory}
            onChange={(e) => setSubcategory(e.target.value)}
            placeholder={isB2c ? "Earbuds" : "Starter"}
          />
          {showRetailFields ? (
            <Input
              label="Stock on hand"
              type="number"
              min="0"
              step="1"
              value={stockOnHand}
              onChange={(e) => setStockOnHand(e.target.value)}
              placeholder="50"
            />
          ) : null}
          <Input
            label="Product URL"
            value={productUrl}
            onChange={(e) => setProductUrl(e.target.value)}
            placeholder={
              isB2c
                ? "https://shop.example.com/products/pulse-earbuds"
                : "https://example.com/products/platform"
            }
          />
          <Input
            label="Tags"
            value={tags}
            onChange={(e) => setTags(e.target.value)}
            placeholder={isB2c ? "bluetooth, consumer" : "voice, chat"}
          />
        </div>
      </Section>

      <Section
        title="Pricing & billing"
        description="Base price charged for the product itself."
      >
        <div className="grid gap-4 sm:grid-cols-2">
          <Input
            label="Base price"
            type="number"
            step="0.01"
            min="0"
            value={price}
            onChange={(e) => setPrice(e.target.value)}
            placeholder={isB2c ? "79.00" : "0.00"}
          />
          <Select
            label="Currency"
            value={currency}
            onChange={(e) => setCurrency(e.target.value)}
            options={CURRENCY_OPTIONS}
          />
          {showQuoteFields ? (
            <>
              <Select
                label="Billing type"
                value={billingType}
                onChange={(e) => setBillingType(e.target.value)}
                options={BILLING_TYPE_OPTIONS}
              />
              {billingType === "recurring" ? (
                <Select
                  label="Billing frequency"
                  value={billingFrequency}
                  onChange={(e) => setBillingFrequency(e.target.value)}
                  options={BILLING_FREQUENCY_OPTIONS}
                />
              ) : null}
              <Input
                label="Max discount %"
                type="number"
                step="0.01"
                min="0"
                max="100"
                value={maxDiscountPercent}
                onChange={(e) => setMaxDiscountPercent(e.target.value)}
                placeholder="No cap"
              />
            </>
          ) : null}
        </div>
        {showQuoteFields ? (
          <p className="mt-2 text-xs text-text-caption">
            Quotes discounting this product beyond this % require Finance
            approval before they can be sent. Leave blank for no cap.
          </p>
        ) : null}
      </Section>


      {showQuoteFields && productType === "customizable" ? (
        <Section
          title="Offers / plans"
          description="Named packages under this product (editions or usage packs). List prices can also live in price books."
        >
          {offers.length === 0 ? (
            <p className="text-sm text-text-caption">
              No offers yet. Add Starter / Pro or a 3000-minute pack.
            </p>
          ) : null}
          <div className="space-y-4">
            {offers.map((offer) => (
              <div
                key={offer.key}
                className="rounded-lg border border-border-default bg-subtle p-4"
              >
                <div className="mb-4 flex items-start justify-between gap-2">
                  <p className="text-sm font-semibold text-text-primary">
                    {offer.name.trim() || "New offer"}
                  </p>
                  <button
                    type="button"
                    className="inline-flex size-8 items-center justify-center rounded-lg text-text-caption hover:bg-surface hover:text-text-danger"
                    aria-label="Remove offer"
                    onClick={() =>
                      setOffers((prev) => prev.filter((o) => o.key !== offer.key))
                    }
                  >
                    <Trash2 className="size-4" />
                  </button>
                </div>
                <div className="grid gap-3 sm:grid-cols-2">
                  <Input
                    label="Name"
                    required
                    value={offer.name}
                    onChange={(e) => updateOffer(offer.key, { name: e.target.value })}
                    placeholder="Starter"
                  />
                  <Input
                    label="Code"
                    value={offer.code}
                    onChange={(e) => updateOffer(offer.key, { code: e.target.value })}
                    placeholder="STARTER"
                  />
                  <Input
                    label="Included quantity"
                    type="number"
                    min="0"
                    value={offer.includedQty}
                    onChange={(e) =>
                      updateOffer(offer.key, { includedQty: e.target.value })
                    }
                    placeholder="3000"
                  />
                  <Select
                    label="Meter"
                    value={offer.meterKey}
                    onChange={(e) =>
                      updateOffer(offer.key, { meterKey: e.target.value })
                    }
                    options={METER_KEY_OPTIONS}
                  />
                  <Select
                    label="Status"
                    value={offer.status}
                    onChange={(e) =>
                      updateOffer(offer.key, { status: e.target.value })
                    }
                    options={OFFER_STATUS_OPTIONS}
                  />
                </div>
              </div>
            ))}
          </div>
          <Button
            type="button"
            variant="secondary"
            onClick={() => setOffers((prev) => [...prev, emptyOffer()])}
          >
            <Plus className="size-4" strokeWidth={2} />
            Add offer
          </Button>
        </Section>
      ) : null}

      {showQuoteFields && productType === "customizable" ? (
        <Section
          title="Addons"
          description="Optional priced components sold with this product. Finance will select quantities later when invoicing."
        >
          {addons.length === 0 ? (
            <p className="text-sm text-text-caption">
              No addons yet. Add Agents, Sessions, integrations, etc.
            </p>
          ) : null}

          <div className="space-y-4">
            {addons.map((addon) => {
              let preview: string | null = null;
              try {
                const qty = Number(addon.previewQty) || 0;
                const amount = priceAddon(
                  {
                    pricingModel: addon.pricingModel,
                    flatPrice: numOrNull(addon.flatPrice),
                    unitPrice: numOrNull(addon.unitPrice),
                    stepSize: numOrNull(addon.stepSize),
                    stepPrice: numOrNull(addon.stepPrice),
                    tiers: addon.tiers.map((t) => ({
                      minQty: Number(t.minQty) || 1,
                      maxQty: t.maxQty.trim() ? Number(t.maxQty) : null,
                      unitPrice: Number(t.unitPrice) || 0,
                    })),
                  },
                  qty,
                );
                preview = formatAddonAmount(amount, currency || "USD");
              } catch {
                preview = null;
              }

              return (
                <div
                  key={addon.key}
                  className="rounded-lg border border-border-default bg-subtle p-4"
                >
                  <div className="mb-4 flex items-start justify-between gap-2">
                    <p className="text-sm font-semibold text-text-primary">
                      {addon.name.trim() || "New addon"}
                    </p>
                    <button
                      type="button"
                      className="inline-flex size-8 items-center justify-center rounded-lg text-text-caption hover:bg-surface hover:text-text-danger"
                      aria-label="Remove addon"
                      onClick={() =>
                        setAddons((prev) =>
                          prev.filter((a) => a.key !== addon.key),
                        )
                      }
                    >
                      <Trash2 className="size-4" />
                    </button>
                  </div>

                  <div className="grid gap-3 sm:grid-cols-2">
                    <Input
                      label="Name"
                      value={addon.name}
                      onChange={(e) =>
                        updateAddon(addon.key, { name: e.target.value })
                      }
                      placeholder="Agents"
                      required
                    />
                    <Input
                      label="Unit label"
                      value={addon.unitLabel}
                      onChange={(e) =>
                        updateAddon(addon.key, { unitLabel: e.target.value })
                      }
                      placeholder="agents"
                    />
                    <Select
                      label="Meter"
                      value={addon.meterKey}
                      onChange={(e) =>
                        updateAddon(addon.key, { meterKey: e.target.value })
                      }
                      options={METER_KEY_OPTIONS}
                    />
                    <div className="flex items-end pb-2">
                      <Checkbox
                        id={`overage-${addon.key}`}
                        checked={addon.isOverage}
                        onChange={(e) =>
                          updateAddon(addon.key, {
                            isOverage: e.target.checked,
                          })
                        }
                        label="Overage / extra usage"
                      />
                    </div>
                    <Select
                      label="Pricing model"
                      value={addon.pricingModel}
                      onChange={(e) =>
                        updateAddon(addon.key, {
                          pricingModel: e.target.value as AddonPricingModel,
                        })
                      }
                      options={PRICING_MODEL_OPTIONS}
                    />
                    {addon.pricingModel === "flat" ? (
                      <Input
                        label="Flat price"
                        type="number"
                        step="0.01"
                        min="0"
                        value={addon.flatPrice}
                        onChange={(e) =>
                          updateAddon(addon.key, { flatPrice: e.target.value })
                        }
                      />
                    ) : null}
                    {addon.pricingModel === "per_unit" ? (
                      <Input
                        label="Unit price"
                        type="number"
                        step="0.0001"
                        min="0"
                        value={addon.unitPrice}
                        onChange={(e) =>
                          updateAddon(addon.key, { unitPrice: e.target.value })
                        }
                      />
                    ) : null}
                    {addon.pricingModel === "stepped" ? (
                      <>
                        <Input
                          label="Step size (pack)"
                          type="number"
                          min="1"
                          step="1"
                          value={addon.stepSize}
                          onChange={(e) =>
                            updateAddon(addon.key, { stepSize: e.target.value })
                          }
                        />
                        <Input
                          label="Step price"
                          type="number"
                          step="0.01"
                          min="0"
                          value={addon.stepPrice}
                          onChange={(e) =>
                            updateAddon(addon.key, {
                              stepPrice: e.target.value,
                            })
                          }
                        />
                      </>
                    ) : null}
                  </div>

                  {addon.pricingModel === "tiered" ? (
                    <div className="mt-3 space-y-2">
                      <p className="text-xs font-medium text-text-caption">
                        Tiers (leave max empty for unbounded)
                      </p>
                      {addon.tiers.map((tier, idx) => (
                        <div
                          key={`${addon.key}-tier-${idx}`}
                          className="grid grid-cols-[1fr_1fr_1fr_auto] gap-2"
                        >
                          <Input
                            aria-label="Min qty"
                            type="number"
                            min="1"
                            value={tier.minQty}
                            onChange={(e) => {
                              const tiers = addon.tiers.slice();
                              tiers[idx] = {
                                ...tier,
                                minQty: e.target.value,
                              };
                              updateAddon(addon.key, { tiers });
                            }}
                            placeholder="Min"
                          />
                          <Input
                            aria-label="Max qty"
                            type="number"
                            min="1"
                            value={tier.maxQty}
                            onChange={(e) => {
                              const tiers = addon.tiers.slice();
                              tiers[idx] = {
                                ...tier,
                                maxQty: e.target.value,
                              };
                              updateAddon(addon.key, { tiers });
                            }}
                            placeholder="Max"
                          />
                          <Input
                            aria-label="Unit price"
                            type="number"
                            step="0.0001"
                            min="0"
                            value={tier.unitPrice}
                            onChange={(e) => {
                              const tiers = addon.tiers.slice();
                              tiers[idx] = {
                                ...tier,
                                unitPrice: e.target.value,
                              };
                              updateAddon(addon.key, { tiers });
                            }}
                            placeholder="Price"
                          />
                          <button
                            type="button"
                            className="inline-flex size-11 items-center justify-center rounded-lg text-text-caption hover:bg-surface hover:text-text-danger"
                            aria-label="Remove tier"
                            disabled={addon.tiers.length <= 1}
                            onClick={() =>
                              updateAddon(addon.key, {
                                tiers: addon.tiers.filter((_, i) => i !== idx),
                              })
                            }
                          >
                            <Trash2 className="size-3.5" />
                          </button>
                        </div>
                      ))}
                      <Button
                        type="button"
                        variant="secondary"
                        className="h-9"
                        onClick={() =>
                          updateAddon(addon.key, {
                            tiers: [
                              ...addon.tiers,
                              { minQty: "", maxQty: "", unitPrice: "" },
                            ],
                          })
                        }
                      >
                        <Plus className="size-3.5" />
                        Add tier
                      </Button>
                    </div>
                  ) : null}

                  <div className="mt-3 flex flex-wrap items-end gap-3 border-t border-border-default/70 pt-3">
                    <Input
                      label="Preview qty"
                      type="number"
                      min="0"
                      className="max-w-[140px]"
                      value={addon.previewQty}
                      onChange={(e) =>
                        updateAddon(addon.key, {
                          previewQty: e.target.value,
                        })
                      }
                    />
                    <p className="pb-2 text-sm text-text-secondary">
                      {preview ? `≈ ${preview}` : "Enter pricing to preview"}
                    </p>
                  </div>
                </div>
              );
            })}
          </div>

          <Button
            type="button"
            variant="secondary"
            onClick={() => setAddons((prev) => [...prev, emptyAddon()])}
          >
            <Plus className="size-4" />
            Add addon
          </Button>
        </Section>
      ) : null}

      <Section title="Description & specification">
        <Textarea
          rows={6}
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder={
            isB2c
              ? "Bluetooth 5.3 earbuds with ANC, 28-hour case battery, IPX4. Sold direct to consumers."
              : "What this product includes…"
          }
        />
      </Section>

      <Section title="Images (optional)">
        <Input
          label="Image URL"
          value={imageUrl}
          onChange={(e) => setImageUrl(e.target.value)}
          placeholder="https://…"
        />
        {imageUrl ? (
          <img
            src={imageUrl}
            alt=""
            className="mt-2 h-24 w-24 rounded-lg object-cover"
          />
        ) : null}
        <Textarea
          label="Additional image URLs"
          rows={3}
          value={galleryUrls}
          onChange={(e) => setGalleryUrls(e.target.value)}
          placeholder="One URL per line"
        />
      </Section>

      {error ? <p className="text-sm text-text-danger">{error}</p> : null}

      <div className="sticky bottom-0 -mx-1 flex flex-wrap justify-end gap-2 border-t border-border-default bg-canvas/95 px-1 pt-4 pb-1 backdrop-blur-sm">
        <Link to={product ? `/product/${product.id}` : "/product"}>
          <Button type="button" variant="secondary" disabled={pending}>
            Cancel
          </Button>
        </Link>
        <Button type="submit" variant="primary" disabled={pending}>
          {pending
            ? "Saving…"
            : resolvedMode === "create"
              ? "Create product"
              : "Save changes"}
        </Button>
      </div>
    </form>
  );
}
