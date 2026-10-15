import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { CheckCircle2, Package, Pencil } from "lucide-react";
import { BackLink } from "@/components/ui/BackLink";
import { Button } from "@/components/ui/Button";
import { RichStructuredContent } from "@/components/content/RichStructuredContent";
import { ConfirmDeleteButton } from "@/components/ui/ConfirmDeleteButton";
import {
  ADDON_PRICING_MODEL_LABELS,
  formatProductPrice,
  PRODUCT_BILLING_FREQUENCY_LABELS,
  PRODUCT_BILLING_TYPE_LABELS,
  PRODUCT_STATUS_LABELS,
  PRODUCT_TYPE_LABELS,
  productStatusChipClass,
} from "@/lib/product-labels";
import { productShowsQuoteFields, productShowsRetailFields } from "@/lib/coworker/field-contracts/product";
import {
  deleteProduct,
  setProductStatus,
  type ProductDetail,
} from "@/services/products";
import { useAppSelector } from "@/store";

function Fact({
  label,
  value,
  mono,
}: {
  label: string;
  value: string;
  mono?: boolean;
}) {
  return (
    <div className="min-w-0">
      <dt className="text-xs font-medium tracking-wide text-text-caption uppercase">
        {label}
      </dt>
      <dd
        className={`mt-1.5 text-sm text-text-primary ${mono ? "font-mono tabular-nums" : ""}`}
      >
        {value}
      </dd>
    </div>
  );
}

export function ProductDetailClientCrm({
  product,
  canEdit,
  onRefresh,
}: {
  product: ProductDetail;
  canEdit: boolean;
  onRefresh?: () => void | Promise<void>;
}) {
  const navigate = useNavigate();
  const businessType = useAppSelector((s) => s.auth.user?.businessType);
  const showRetailFields = productShowsRetailFields(businessType);
  const showQuoteFields = productShowsQuoteFields(businessType);
  const galleryUrls = product.galleryUrls ?? [];
  const addons = product.addons ?? [];
  const [activeImage, setActiveImage] = useState(
    product.imageUrl || galleryUrls[0] || null,
  );
  const [activating, setActivating] = useState(false);
  const [activateError, setActivateError] = useState<string | null>(null);
  const isDraft = product.status === "draft";
  const isArchived = product.status === "archived";

  const onActivate = async () => {
    setActivateError(null);
    setActivating(true);
    try {
      const result = await setProductStatus(product.id, "active");
      if (!result.ok) {
        setActivateError(result.error);
        return;
      }
      await onRefresh?.();
    } catch {
      setActivateError("Failed to activate product.");
    } finally {
      setActivating(false);
    }
  };

  const gallery = [
    ...(product.imageUrl ? [product.imageUrl] : []),
    ...galleryUrls.filter((u) => u !== product.imageUrl),
  ];

  const tags = product.tags
    ?.split(",")
    .map((t) => t.trim())
    .filter(Boolean);

  const description = [product.description, product.specifications]
    .filter(Boolean)
    .join("\n\n");

  const billingLabel = [
    PRODUCT_BILLING_TYPE_LABELS[product.billingType ?? "one_time"] ?? "One-time",
    product.billingFrequency
      ? PRODUCT_BILLING_FREQUENCY_LABELS[product.billingFrequency]
      : null,
  ]
    .filter(Boolean)
    .join(" · ");

  return (
    <div className="mx-auto max-w-4xl px-4 py-6 sm:px-6 sm:py-8">
      <BackLink to="/product">Products</BackLink>

      <div className="mt-5 mb-6 flex flex-wrap items-start justify-between gap-4">
        <div className="flex min-w-0 flex-1 items-start gap-4">
          <div className="shrink-0 overflow-hidden rounded-xl border border-border-default bg-subtle">
            <div className="size-16 sm:size-20">
              {activeImage ? (
                <img
                  src={activeImage}
                  alt=""
                  className="size-full object-cover"
                />
              ) : (
                <div className="flex size-full items-center justify-center text-text-caption">
                  <Package className="size-7" strokeWidth={1.5} />
                </div>
              )}
            </div>
          </div>
          <div className="min-w-0 pt-0.5">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="text-xl font-semibold tracking-tight text-text-primary sm:text-2xl">
                {product.name}
              </h1>
              <span className={productStatusChipClass(product.status)}>
                {PRODUCT_STATUS_LABELS[product.status] ?? product.status}
              </span>
              {showQuoteFields ? (
              <span className="inline-flex items-center rounded-md bg-subtle px-2.5 py-0.5 text-xs font-medium text-text-secondary">
                {PRODUCT_TYPE_LABELS[product.productType ?? ""] ??
                  product.productType}
              </span>
              ) : null}
            </div>
            <p className="mt-2 text-sm leading-5 text-text-caption">
              {[
                product.sku ? `SKU ${product.sku}` : null,
                showRetailFields ? product.brand : null,
                product.category,
                product.subcategory,
                showRetailFields && product.stockOnHand != null
                  ? `${product.stockOnHand} in stock`
                  : null,
              ]
                .filter(Boolean)
                .join(" · ") || "Product catalog"}
            </p>
            {gallery.length > 1 ? (
              <div className="mt-3 flex gap-1.5">
                {gallery.map((url) => (
                  <button
                    key={url}
                    type="button"
                    onClick={() => setActiveImage(url)}
                    className={`size-8 overflow-hidden rounded-md border transition-colors ${
                      activeImage === url
                        ? "border-border-strong ring-1 ring-border-strong"
                        : "border-border-default hover:border-border-strong"
                    }`}
                    aria-label="Show image"
                  >
                    <img src={url} alt="" className="size-full object-cover" />
                  </button>
                ))}
              </div>
            ) : null}
          </div>
        </div>
        {canEdit ? (
          <div className="flex flex-wrap gap-2">
            {isDraft || isArchived ? (
              <Button
                type="button"
                onClick={() => void onActivate()}
                disabled={activating}
              >
                <CheckCircle2 className="size-4" />
                {activating
                  ? "Activating…"
                  : isArchived
                    ? "Restore to active"
                    : "Activate"}
              </Button>
            ) : null}
            <Link to={`/product/${product.id}/edit`}>
              <Button type="button" variant="secondary">
                <Pencil className="size-4" />
                Edit
              </Button>
            </Link>
            <ConfirmDeleteButton
              name={product.name}
              entityLabel="product"
              consequence="This permanently removes the product from the catalog."
              onConfirm={async () => {
                const result = await deleteProduct(product.id);
                if (!result.ok) return { ok: false, error: result.error };
                return { ok: true };
              }}
              onSuccess={() => {
                navigate("/product");
              }}
            />
          </div>
        ) : null}
      </div>

      {isDraft && canEdit ? (
        <div className="mb-4 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-950">
          <p className="font-medium">This product is still a draft</p>
          <p className="mt-0.5 text-amber-900/90">
            Click <span className="font-semibold">Activate</span> to make it
            available for quotes and orders. You can still edit details anytime.
          </p>
          {activateError ? (
            <p className="mt-2 text-sm text-text-danger">{activateError}</p>
          ) : null}
        </div>
      ) : null}
      {activateError && !isDraft ? (
        <p className="mb-4 text-sm text-text-danger">{activateError}</p>
      ) : null}

      <div className="space-y-4">
        <section className="rounded-xl border border-border-default bg-surface p-5 sm:p-6">
          <h2 className="text-base font-semibold tracking-tight text-text-primary">
            Product details
          </h2>
          <dl className="mt-5 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
            <Fact label="Name" value={product.name} />
            <Fact label="SKU" value={product.sku || "—"} mono />
            {showRetailFields ? (
              <Fact label="Brand" value={product.brand?.trim() || "—"} />
            ) : null}
            <Fact label="Subcategory" value={product.subcategory?.trim() || "—"} />
            {showRetailFields ? (
              <Fact
                label="Stock on hand"
                value={
                  product.stockOnHand == null
                    ? "Not tracked"
                    : String(product.stockOnHand)
                }
              />
            ) : null}
            {product.productUrl?.trim() ? (
              <div className="min-w-0 sm:col-span-2 lg:col-span-3">
                <dt className="text-xs font-medium tracking-wide text-text-caption uppercase">
                  Product URL
                </dt>
                <dd className="mt-1.5 truncate text-sm">
                  <a
                    href={product.productUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-text-primary underline-offset-2 hover:underline"
                  >
                    {product.productUrl}
                  </a>
                </dd>
              </div>
            ) : (
              <Fact label="Product URL" value="—" />
            )}
            <Fact
              label="Status"
              value={PRODUCT_STATUS_LABELS[product.status] ?? product.status}
            />
            {showQuoteFields ? (
            <Fact
              label="Type"
              value={
                PRODUCT_TYPE_LABELS[product.productType ?? ""] ??
                product.productType
              }
            />
            ) : null}
            <Fact label="Category" value={product.category || "—"} />
            <Fact
              label="Price"
              value={formatProductPrice(
                product.price ?? product.listPrice ?? null,
                product.currency,
              )}
            />
            <Fact label="Currency" value={product.currency || "USD"} />
            {showQuoteFields ? (
            <Fact label="Billing" value={billingLabel} />
            ) : null}
            {tags && tags.length > 0 ? (
              <div className="min-w-0 sm:col-span-2 lg:col-span-3">
                <dt className="text-xs font-medium tracking-wide text-text-caption uppercase">
                  Tags
                </dt>
                <dd className="mt-2 flex flex-wrap gap-1.5">
                  {tags.map((tag) => (
                    <span
                      key={tag}
                      className="rounded-md bg-subtle px-2.5 py-0.5 text-xs font-medium text-text-secondary"
                    >
                      {tag}
                    </span>
                  ))}
                </dd>
              </div>
            ) : (
              <Fact label="Tags" value="—" />
            )}
          </dl>
        </section>

        {showQuoteFields &&
        product.productType === "customizable" &&
        (product.offers?.length ?? 0) > 0 ? (
          <section className="rounded-xl border border-border-default bg-surface p-5 sm:p-6">
            <h2 className="text-base font-semibold tracking-tight text-text-primary">
              Offers / plans
            </h2>
            <ul className="mt-5 divide-y divide-border-default overflow-hidden rounded-lg border border-border-default">
              {(product.offers ?? []).map((offer) => (
                <li key={offer.id} className="bg-surface px-4 py-3.5 text-sm">
                  <div className="flex flex-wrap items-baseline justify-between gap-2">
                    <p className="font-medium text-text-primary">
                      {offer.name}
                      {offer.code ? (
                        <span className="ml-1.5 font-mono text-xs font-normal text-text-caption">
                          {offer.code}
                        </span>
                      ) : null}
                    </p>
                    <span className="tabular-nums text-text-secondary">
                      {formatProductPrice(
                        offer.listPrice ?? product.listPrice ?? product.price,
                        product.currency,
                      )}
                    </span>
                  </div>
                  <p className="mt-1 text-xs text-text-caption">
                    {[
                      offer.includedQty != null
                        ? `Includes ${offer.includedQty}${offer.meterKey ? ` ${offer.meterKey}` : ""}`
                        : null,
                      offer.status,
                    ]
                      .filter(Boolean)
                      .join(" · ")}
                  </p>
                </li>
              ))}
            </ul>
          </section>
        ) : null}

        {showQuoteFields && product.productType === "customizable" ? (
          <section className="rounded-xl border border-border-default bg-surface p-5 sm:p-6">
            <h2 className="text-base font-semibold tracking-tight text-text-primary">
              Addons
            </h2>
            {addons.length === 0 ? (
              <p className="mt-3 text-sm leading-5 text-text-caption">
                No addons configured yet.
              </p>
            ) : (
              <ul className="mt-5 divide-y divide-border-default overflow-hidden rounded-lg border border-border-default">
                {addons.map((addon) => (
                  <li key={addon.id} className="bg-surface px-4 py-3.5 text-sm">
                    <div className="flex flex-wrap items-baseline justify-between gap-2">
                      <p className="font-medium text-text-primary">
                        {addon.name}
                        {addon.unitLabel ? (
                          <span className="ml-1.5 font-normal text-text-caption">
                            ({addon.unitLabel})
                          </span>
                        ) : null}
                        {addon.isOverage ? (
                          <span className="ml-1.5 text-xs font-medium text-text-warning">
                            overage
                          </span>
                        ) : null}
                        {addon.meterKey ? (
                          <span className="ml-1.5 text-xs font-normal text-text-caption">
                            · {addon.meterKey}
                          </span>
                        ) : null}
                      </p>
                      <span className="text-xs font-medium text-text-caption">
                        {ADDON_PRICING_MODEL_LABELS[addon.pricingModel] ??
                          addon.pricingModel}
                      </span>
                    </div>
                    <p className="mt-1.5 tabular-nums text-text-secondary">
                      {addon.pricingModel === "flat"
                        ? formatProductPrice(addon.flatPrice, product.currency)
                        : null}
                      {addon.pricingModel === "per_unit"
                        ? `${formatProductPrice(addon.unitPrice, product.currency)} / unit`
                        : null}
                      {addon.pricingModel === "stepped"
                        ? `${formatProductPrice(addon.stepPrice, product.currency)} per ${addon.stepSize ?? "—"}`
                        : null}
                      {addon.pricingModel === "tiered"
                        ? `${addon.tiers.length} tier${addon.tiers.length === 1 ? "" : "s"}`
                        : null}
                    </p>
                    {addon.pricingModel === "tiered" && addon.tiers.length ? (
                      <ul className="mt-2 space-y-1 text-xs text-text-caption">
                        {addon.tiers.map((tier) => (
                          <li key={tier.id}>
                            Qty {tier.minQty}
                            {tier.maxQty != null ? `–${tier.maxQty}` : "+"}:{" "}
                            {formatProductPrice(
                              tier.unitPrice,
                              product.currency,
                            )}
                          </li>
                        ))}
                      </ul>
                    ) : null}
                  </li>
                ))}
              </ul>
            )}
          </section>
        ) : null}

        <section className="rounded-xl border border-border-default bg-surface p-5 sm:p-6">
          <h2 className="text-base font-semibold tracking-tight text-text-primary">
            Description & specification
          </h2>
          {description ? (
            <RichStructuredContent
              className="mt-3"
              text={description}
              variant="document"
            />
          ) : (
            <p className="mt-3 text-sm leading-5 text-text-caption">
              No description added yet.
            </p>
          )}
        </section>
      </div>
    </div>
  );
}
