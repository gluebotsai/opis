import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { Plus, Trash2 } from "lucide-react";
import { FinanceShell } from "@/components/finance/FinanceShell";
import { PaymentTermsField } from "@/components/finance/PaymentTermsField";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Select } from "@/components/ui/Select";
import { DropdownSelect } from "@/components/ui/DropdownSelect";
import { Textarea } from "@/components/ui/Textarea";
import { formatAddonAmount, priceAddon } from "@/lib/addon-pricing";
import {
  formatInvoiceMoney,
  INVOICE_BILLING_KIND_LABELS,
} from "@/lib/invoice-labels";
import {
  normalizePaymentTerms,
} from "@/lib/invoice-payment-terms";
import { canEditFinance, normalizeRole } from "@/lib/rbac";
import {
  INDIA_GST_RATE_OPTIONS,
  INDIA_STATES,
  TAX_COUNTRY_OPTIONS,
  UK_VAT_OPTIONS,
  computeGlobalTax,
  type IndiaGstRate,
  type TaxCountry,
  type UkVatCategory,
} from "@/lib/tax/global-tax";
import {
  createInvoice,
  fetchDealInvoiceAutofill,
  fetchInvoiceCreateOptions,
  sendInvoiceEmail,
  type DealInvoiceAutofill,
  type DealInvoiceOption,
  type InvoiceBarItem,
  type InvoiceProductOption,
  type InvoiceTaxConfigInput,
} from "@/services/finance";
import { useAppSelector } from "@/store";
import { SkeletonText } from "@/components/skeleton/SkeletonText";
import { FinanceInvoiceCreateSkeleton } from "./FinancePageSkeleton";

const CURRENCY_OPTIONS = [
  { value: "USD", label: "USD — US Dollar" },
  { value: "EUR", label: "EUR — Euro" },
  { value: "GBP", label: "GBP — British Pound" },
  { value: "INR", label: "INR — Indian Rupee" },
  { value: "AED", label: "AED — UAE Dirham" },
];

type DraftLine = {
  key: string;
  groupId: string;
  kind: "product" | "addon";
  productId: string | null;
  addonId: string | null;
  name: string;
  description: string;
  quantity: number;
  unitPrice: number;
  taxPercent: number;
  amount: number;
};

type ProductGroup = {
  groupId: string;
  product: DraftLine;
  addons: DraftLine[];
};

function newKey() {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function roundMoney(n: number) {
  return Math.round(n * 100) / 100;
}

function currencyDiscountSymbol(currencyCode: string): string {
  switch (currencyCode.toUpperCase()) {
    case "INR":
      return "₹";
    case "GBP":
      return "£";
    case "EUR":
      return "€";
    case "AED":
      return "د.إ";
    default:
      return "$";
  }
}

function toDateInputValue(isoDate: string) {
  return isoDate.slice(0, 10);
}

function lineTax(amount: number, taxPercent: number) {
  return roundMoney(amount * ((taxPercent || 0) / 100));
}

function lineTotal(amount: number, taxPercent: number) {
  return roundMoney(amount + lineTax(amount, taxPercent));
}

function computeAddonAmount(
  addon: InvoiceProductOption["addons"][number],
  qty: number,
): number {
  return roundMoney(
    priceAddon(
      {
        pricingModel: addon.pricingModel,
        flatPrice: addon.flatPrice ? Number(addon.flatPrice) : null,
        unitPrice: addon.unitPrice ? Number(addon.unitPrice) : null,
        stepSize: addon.stepSize,
        stepPrice: addon.stepPrice ? Number(addon.stepPrice) : null,
        tiers: addon.tiers.map((t) => ({
          minQty: t.minQty,
          maxQty: t.maxQty,
          unitPrice: Number(t.unitPrice),
        })),
      },
      qty,
    ),
  );
}

export function InvoiceCreatePage() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const user = useAppSelector((s) => s.auth.user);
  const canEdit = canEditFinance(normalizeRole(user?.role));

  // Prefill from deep links / agent: /finance/new?dealId=&currency=&notes=&paymentTerms=
  const initialQueryRef = useRef({
    dealId: searchParams.get("dealId") ?? "",
    currency: searchParams.get("currency") ?? "",
    notes: searchParams.get("notes") ?? "",
    paymentTerms: searchParams.get("paymentTerms") ?? "",
  });

  const [bar, setBar] = useState<InvoiceBarItem[]>([]);
  const [deals, setDeals] = useState<DealInvoiceOption[]>([]);
  const [products, setProducts] = useState<InvoiceProductOption[]>([]);
  const [templates, setTemplates] = useState<
    Array<{ id: string; name: string; isDefault: boolean }>
  >([]);
  const [templateId, setTemplateId] = useState("");
  const [loading, setLoading] = useState(true);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<{
    dealId?: string;
    issueDate?: string;
    dueDate?: string;
    currency?: string;
    products?: string;
    sellerState?: string;
    buyerState?: string;
  }>({});

  const [dealId, setDealId] = useState("");
  const [autofill, setAutofill] = useState<DealInvoiceAutofill | null>(null);
  const [loadingDeal, setLoadingDeal] = useState(false);

  const [currency, setCurrency] = useState("USD");
  const [billingKind, setBillingKind] = useState("standard");
  const [paymentTerms, setPaymentTerms] = useState("Net 30");
  const [issueDate, setIssueDate] = useState(
    () => new Date().toISOString().slice(0, 10),
  );
  const [dueDate, setDueDate] = useState(() => {
    const d = new Date();
    d.setDate(d.getDate() + 30);
    return d.toISOString().slice(0, 10);
  });
  const [billingAddress, setBillingAddress] = useState("");
  const [leadEmail, setLeadEmail] = useState("");
  const [leadPhone, setLeadPhone] = useState("");
  const [taxId, setTaxId] = useState("");
  const [notes, setNotes] = useState("");
  const [discountValue, setDiscountValue] = useState(0);
  const [discountMode, setDiscountMode] = useState<"percent" | "fixed">(
    "percent",
  );

  const [taxCountry, setTaxCountry] = useState<TaxCountry>("IN");
  const [indiaGstRate, setIndiaGstRate] = useState<IndiaGstRate>(18);
  const [sellerState, setSellerState] = useState("TN");
  const [buyerState, setBuyerState] = useState("TN");
  const [ukVatCategory, setUkVatCategory] =
    useState<UkVatCategory>("standard");
  const [usStatePercent, setUsStatePercent] = useState(0);
  const [usCountyPercent, setUsCountyPercent] = useState(0);
  const [usCityPercent, setUsCityPercent] = useState(0);
  const [usDistrictPercent, setUsDistrictPercent] = useState(0);

  const [selectedProductId, setSelectedProductId] = useState("");
  const [productQty, setProductQty] = useState(1);
  const [addonQtyById, setAddonQtyById] = useState<Record<string, number>>({});
  const [lines, setLines] = useState<DraftLine[]>([]);

  useEffect(() => {
    if (!canEdit) {
      navigate("/finance", { replace: true });
      return;
    }
    void (async () => {
      setLoading(true);
      try {
        const opts = await fetchInvoiceCreateOptions();
        setDeals(opts.deals);
        setProducts(opts.products);
        setBar(opts.bar);
        const tpl = opts.templates ?? [];
        setTemplates(tpl);
        const active = tpl.find((t) => t.isDefault) ?? tpl[0];
        if (active) setTemplateId(active.id);
        const initial = initialQueryRef.current;
        if (initial.dealId && opts.deals.some((d) => d.id === initial.dealId)) {
          await onDealChange(initial.dealId);
          if (initial.currency) setCurrency(initial.currency);
          if (initial.paymentTerms) {
            setPaymentTerms(normalizePaymentTerms(initial.paymentTerms));
          }
          if (initial.notes) setNotes(initial.notes);
        }
      } catch {
        setError("Failed to load create options.");
      } finally {
        setLoading(false);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canEdit, navigate]);

  const selectedProduct =
    products.find((p) => p.id === selectedProductId) ?? null;

  const dealOptions = [
    { value: "", label: "Select a deal…" },
    ...deals.map((d) => ({
      value: d.id,
      label: `${d.title} — ${d.companyName}`,
    })),
  ];

  const productOptions = [
    { value: "", label: "Select a product…" },
    ...products.map((p) => ({
      value: p.id,
      label: `${p.name}${p.sku ? ` (${p.sku})` : ""} — ${p.price ?? "0"} ${p.currency}`,
    })),
  ];

  const countryOptions = TAX_COUNTRY_OPTIONS.map((c) => ({
    value: c.value,
    label: `${c.label} — ${c.system}`,
  }));

  const indiaStateOptions = [
    { value: "", label: "Select state / UT…" },
    ...INDIA_STATES.map((s) => ({
      value: s.value,
      label: s.ut ? `${s.label} (UT)` : s.label,
    })),
  ];

  const indiaRateOptions = INDIA_GST_RATE_OPTIONS.map((r) => ({
    value: r.value,
    label: r.label,
  }));

  const ukVatOptions = UK_VAT_OPTIONS.map((r) => ({
    value: r.value,
    label: r.label,
  }));

  const taxConfig: InvoiceTaxConfigInput = useMemo(() => {
    if (taxCountry === "IN") {
      return {
        country: "IN",
        gstRate: indiaGstRate,
        sellerState,
        buyerState,
      };
    }
    if (taxCountry === "UK") {
      return { country: "UK", vatCategory: ukVatCategory };
    }
    return {
      country: "US",
      statePercent: usStatePercent,
      countyPercent: usCountyPercent,
      cityPercent: usCityPercent,
      specialDistrictPercent: usDistrictPercent,
    };
  }, [
    taxCountry,
    indiaGstRate,
    sellerState,
    buyerState,
    ukVatCategory,
    usStatePercent,
    usCountyPercent,
    usCityPercent,
    usDistrictPercent,
  ]);

  const groups: ProductGroup[] = useMemo(() => {
    const map = new Map<string, ProductGroup>();
    for (const line of lines) {
      if (line.kind === "product") {
        map.set(line.groupId, {
          groupId: line.groupId,
          product: line,
          addons: [],
        });
      }
    }
    for (const line of lines) {
      if (line.kind === "addon") {
        const group = map.get(line.groupId);
        if (group) group.addons.push(line);
      }
    }
    return [...map.values()];
  }, [lines]);

  const merchandiseSubtotal = useMemo(
    () => roundMoney(lines.reduce((sum, line) => sum + line.amount, 0)),
    [lines],
  );

  const discountAmount = useMemo(() => {
    const raw = Number(discountValue) || 0;
    if (raw <= 0) return 0;
    if (discountMode === "percent") {
      const pct = Math.min(100, Math.max(0, raw));
      return roundMoney(merchandiseSubtotal * (pct / 100));
    }
    return roundMoney(Math.min(merchandiseSubtotal, Math.max(0, raw)));
  }, [discountValue, discountMode, merchandiseSubtotal]);

  const taxableAmount = useMemo(
    () => roundMoney(Math.max(0, merchandiseSubtotal - discountAmount)),
    [merchandiseSubtotal, discountAmount],
  );

  const taxBreakdown = useMemo(() => {
    if (taxConfig.country === "IN") {
      return computeGlobalTax({
        country: "IN",
        gstRate: taxConfig.gstRate,
        sellerState: taxConfig.sellerState,
        buyerState: taxConfig.buyerState,
        taxableAmount,
      });
    }
    if (taxConfig.country === "UK") {
      return computeGlobalTax({
        country: "UK",
        vatCategory: taxConfig.vatCategory,
        taxableAmount,
      });
    }
    return computeGlobalTax({
      country: "US",
      taxableAmount,
      statePercent: taxConfig.statePercent,
      countyPercent: taxConfig.countyPercent,
      cityPercent: taxConfig.cityPercent,
      specialDistrictPercent: taxConfig.specialDistrictPercent,
    });
  }, [taxConfig, taxableAmount]);

  const taxPercent = taxBreakdown.effectivePercent;

  useEffect(() => {
    setLines((prev) => {
      if (!prev.length) return prev;
      if (prev.every((line) => line.taxPercent === taxPercent)) return prev;
      return prev.map((line) => ({ ...line, taxPercent }));
    });
  }, [taxPercent]);

  const onTaxCountryChange = (value: string) => {
    const next = value as TaxCountry;
    setTaxCountry(next);
    if (next === "IN") setCurrency("INR");
    if (next === "UK") setCurrency("GBP");
    if (next === "US") setCurrency("USD");
  };

  const onDealChange = async (nextDealId: string) => {
    setDealId(nextDealId);
    setAutofill(null);
    setError(null);
    if (!nextDealId) return;
    setLoadingDeal(true);
    try {
      const result = await fetchDealInvoiceAutofill(nextDealId);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      const data = result.data;
      setAutofill(data);
      setCurrency(
        CURRENCY_OPTIONS.some((o) => o.value === data.currency)
          ? data.currency
          : "USD",
      );
      setPaymentTerms(normalizePaymentTerms(data.paymentTerms));
      setIssueDate(toDateInputValue(data.issueDate));
      setDueDate(toDateInputValue(data.dueDate));
      setBillingAddress(data.billingAddress);
      setLeadEmail(data.leadEmail);
      setLeadPhone(data.leadPhone);
      setTaxId(data.tax.taxId || "");
      setTaxCountry(data.tax.country);
      setIndiaGstRate(data.tax.indiaGstRate);
      setSellerState(data.tax.sellerState || "");
      setBuyerState(data.tax.buyerState || "");
      setUkVatCategory(data.tax.ukVatCategory);
      setUsStatePercent(data.tax.usStatePercent);
      setUsCountyPercent(data.tax.usCountyPercent);
      setUsCityPercent(data.tax.usCityPercent);
      setUsDistrictPercent(data.tax.usDistrictPercent);
    } finally {
      setLoadingDeal(false);
    }
  };

  const buildLinesFromPicker = ():
    | { ok: true; lines: DraftLine[]; currency: string | null }
    | { ok: false; error: string } => {
    if (!selectedProduct) {
      return { ok: false, error: "Select a product first." };
    }
    const qty = Number(productQty);
    if (!Number.isFinite(qty) || qty <= 0) {
      return { ok: false, error: "Product quantity must be positive." };
    }

    const groupId = newKey();
    const unitPrice = Number(selectedProduct.price ?? 0);
    const amount = roundMoney(qty * unitPrice);
    const next: DraftLine[] = [
      {
        key: newKey(),
        groupId,
        kind: "product",
        productId: selectedProduct.id,
        addonId: null,
        name: selectedProduct.name,
        description: selectedProduct.sku
          ? `SKU ${selectedProduct.sku}`
          : "Product",
        quantity: qty,
        unitPrice,
        taxPercent,
        amount,
      },
    ];

    if (selectedProduct.productType === "customizable") {
      for (const addon of selectedProduct.addons) {
        const isFlat = String(addon.pricingModel).toLowerCase() === "flat";
        const rawQty = Number(addonQtyById[addon.id] ?? 0);
        if (!rawQty || rawQty <= 0) continue;
        const addonQty = isFlat ? 1 : rawQty;
        try {
          const addonAmount = computeAddonAmount(addon, addonQty);
          next.push({
            key: newKey(),
            groupId,
            kind: "addon",
            productId: selectedProduct.id,
            addonId: addon.id,
            name: addon.name,
            description: isFlat
              ? "Add-on (flat)"
              : `Add-on${addon.unitLabel ? ` · ${addon.unitLabel}` : ""}`,
            quantity: addonQty,
            unitPrice:
              addonQty > 0 ? roundMoney(addonAmount / addonQty) : addonAmount,
            taxPercent,
            amount: addonAmount,
          });
        } catch (err) {
          return {
            ok: false,
            error:
              err instanceof Error
                ? err.message
                : `Failed to price add-on ${addon.name}.`,
          };
        }
      }
    }

    const nextCurrency =
      selectedProduct.currency &&
      CURRENCY_OPTIONS.some((o) => o.value === selectedProduct.currency)
        ? selectedProduct.currency
        : null;

    return { ok: true, lines: next, currency: nextCurrency };
  };

  const clearProductPicker = () => {
    setSelectedProductId("");
    setProductQty(1);
    setAddonQtyById({});
  };

  const addProduct = () => {
    const built = buildLinesFromPicker();
    if (!built.ok) {
      setError(built.error);
      return;
    }
    setLines((prev) => [...prev, ...built.lines]);
    setError(null);
    setFieldErrors((prev) => ({ ...prev, products: undefined }));
    clearProductPicker();
    if (built.currency) setCurrency(built.currency);
  };

  const removeGroup = (groupId: string) => {
    setLines((prev) => prev.filter((line) => line.groupId !== groupId));
  };

  const updateProductQty = (groupId: string, quantity: number) => {
    setLines((prev) =>
      prev.map((line) => {
        if (line.groupId !== groupId || line.kind !== "product") return line;
        const amount = roundMoney(quantity * line.unitPrice);
        return { ...line, quantity, amount };
      }),
    );
  };

  const updateAddonQty = (lineKey: string, quantity: number) => {
    setLines((prev) =>
      prev.map((line) => {
        if (line.key !== lineKey || line.kind !== "addon" || !line.addonId) {
          return line;
        }
        const product = products.find((p) => p.id === line.productId);
        const addon = product?.addons.find((a) => a.id === line.addonId);
        if (!addon) return line;
        if (String(addon.pricingModel).toLowerCase() === "flat") {
          return line;
        }
        try {
          const amount = computeAddonAmount(addon, quantity);
          return {
            ...line,
            quantity,
            amount,
            unitPrice:
              quantity > 0 ? roundMoney(amount / quantity) : line.unitPrice,
          };
        } catch {
          return line;
        }
      }),
    );
  };

  const breakdown = useMemo(() => {
    return groups.map((group) => {
      const productTaxAmt = lineTax(
        group.product.amount,
        group.product.taxPercent,
      );
      const productTotal = lineTotal(
        group.product.amount,
        group.product.taxPercent,
      );
      const addonRows = group.addons.map((addon) => {
        const taxAmt = lineTax(addon.amount, addon.taxPercent);
        return {
          addon,
          taxAmt,
          total: lineTotal(addon.amount, addon.taxPercent),
        };
      });
      const addonsSubtotal = roundMoney(
        addonRows.reduce((s, r) => s + r.addon.amount, 0),
      );
      const addonsTax = roundMoney(
        addonRows.reduce((s, r) => s + r.taxAmt, 0),
      );
      const groupSubtotal = roundMoney(
        group.product.amount + addonsSubtotal,
      );
      const groupTax = roundMoney(productTaxAmt + addonsTax);
      const groupTotal = roundMoney(groupSubtotal + groupTax);
      return {
        group,
        productTaxAmt,
        productTotal,
        addonRows,
        addonsSubtotal,
        addonsTax,
        groupSubtotal,
        groupTax,
        groupTotal,
      };
    });
  }, [groups]);

  const taxTotal = taxBreakdown.taxAmount;
  const total = roundMoney(taxableAmount + taxTotal);

  const submit = async (status: "draft" | "sent") => {
    setError(null);
    const nextFieldErrors: typeof fieldErrors = {};

    // Selecting in the picker does not add a line until "Add product".
    // If the user saved with a pending selection, commit it first.
    let invoiceLines = lines;
    let invoiceCurrency = currency;
    if (!invoiceLines.length && selectedProductId) {
      const built = buildLinesFromPicker();
      if (!built.ok) {
        nextFieldErrors.products = built.error;
        setFieldErrors(nextFieldErrors);
        setError(built.error);
        return;
      }
      invoiceLines = built.lines;
      if (built.currency) invoiceCurrency = built.currency;
      setLines(built.lines);
      clearProductPicker();
      if (built.currency) setCurrency(built.currency);
    }

    if (!dealId) {
      nextFieldErrors.dealId = "Select a deal.";
    }
    if (!issueDate.trim()) {
      nextFieldErrors.issueDate = "Issue date is required.";
    }
    if (!dueDate.trim()) {
      nextFieldErrors.dueDate = "Due date is required.";
    }
    if (!invoiceCurrency.trim()) {
      nextFieldErrors.currency = "Currency is required.";
    }
    if (!invoiceLines.length) {
      nextFieldErrors.products = "Add at least one product.";
    }
    if (taxCountry === "IN") {
      if (!sellerState.trim()) {
        nextFieldErrors.sellerState = "Seller state is required for India GST.";
      }
      if (!buyerState.trim()) {
        nextFieldErrors.buyerState = "Buyer state is required for India GST.";
      }
    }

    if (Object.keys(nextFieldErrors).length > 0) {
      setFieldErrors(nextFieldErrors);
      setError(
        nextFieldErrors.products ||
          nextFieldErrors.dealId ||
          nextFieldErrors.sellerState ||
          nextFieldErrors.buyerState ||
          "Fill in the required fields marked with *.",
      );
      return;
    }
    setFieldErrors({});

    setPending(true);
    const result = await createInvoice({
      dealId,
      currency: invoiceCurrency,
      status,
      billingKind,
      paymentTerms: normalizePaymentTerms(paymentTerms),
      notes,
      billingAddress,
      leadEmail,
      leadPhone,
      taxId,
      discountAmount,
      issueDate,
      dueAt: dueDate,
      taxConfig,
      templateId: templateId || null,
      lines: invoiceLines.map((line) => ({
        kind: line.kind,
        productId: line.productId,
        addonId: line.addonId,
        name: line.name,
        description: line.description,
        quantity: line.quantity,
        unitPrice: line.unitPrice,
        taxPercent,
        amount: line.amount,
      })),
    });
    if (!result.ok) {
      setPending(false);
      setError(result.error);
      return;
    }
    if (status === "sent") {
      const emailed = await sendInvoiceEmail(result.id);
      setPending(false);
      if (!emailed.ok) {
        setError(emailed.error);
        navigate(`/finance/${result.id}`);
        return;
      }
    } else {
      setPending(false);
    }
    navigate(`/finance/${result.id}`);
  };

  if (loading) {
    return <FinanceInvoiceCreateSkeleton />;
  }

  return (
    <FinanceShell invoices={bar} showNew>
      <div className="crm-fade-in space-y-6">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="text-xs font-medium tracking-wide text-text-caption uppercase">
              New invoice
            </p>
            <h2 className="mt-1 text-lg font-semibold text-text-primary">
              Create from deal
            </h2>
            <p className="mt-1 text-sm text-text-caption">
              Add products and add-ons. Tax follows the selected region.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Link to="/finance">
              <Button type="button" variant="secondary" disabled={pending}>
                Cancel
              </Button>
            </Link>
            <Button
              type="button"
              variant="secondary"
              disabled={pending}
              onClick={() => void submit("draft")}
            >
              {pending ? "Saving…" : "Save as draft"}
            </Button>
            <Button
              type="button"
              variant="primary"
              disabled={pending}
              onClick={() => void submit("sent")}
            >
              {pending ? "Saving…" : "Review and send"}
            </Button>
          </div>
        </div>

        {error ? (
          <p
            className="rounded-lg border border-text-danger/20 bg-text-danger/5 px-3 py-2 text-sm text-text-danger"
            role="alert"
          >
            {error}
          </p>
        ) : null}

        {autofill?.existingInvoiceId ? (
          <p className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
            This deal already has invoice{" "}
            <Link
              to={`/finance/${autofill.existingInvoiceId}`}
              className="font-medium underline"
            >
              {autofill.existingInvoiceNumber}
            </Link>
            . You can still create another if needed.
          </p>
        ) : null}

        <section className="rounded-xl border border-border-default bg-surface p-5 sm:p-6">
          <h3 className="text-sm font-semibold text-text-primary">
            General information
          </h3>
          <div className="mt-4 grid gap-4 sm:grid-cols-2">
            <Select
              label="Linked deal"
              required
              value={dealId}
              error={fieldErrors.dealId}
              onChange={(e) => {
                setFieldErrors((prev) => ({ ...prev, dealId: undefined }));
                void onDealChange(e.target.value);
              }}
              options={dealOptions}
              disabled={loadingDeal || pending}
            />
            <div>
              <Input
                label="Customer / account"
                value={autofill?.companyName ?? ""}
                readOnly
                placeholder={loadingDeal ? undefined : "Select a deal"}
                aria-busy={loadingDeal}
              />
              {loadingDeal ? (
                <div className="mt-2">
                  <SkeletonText width={120} height={12} />
                </div>
              ) : null}
            </div>
            <Input
              label="Issue date"
              type="date"
              required
              value={issueDate}
              error={fieldErrors.issueDate}
              onChange={(e) => {
                setFieldErrors((prev) => ({ ...prev, issueDate: undefined }));
                setIssueDate(e.target.value);
              }}
            />
            <Input
              label="Due date"
              type="date"
              required
              value={dueDate}
              error={fieldErrors.dueDate}
              onChange={(e) => {
                setFieldErrors((prev) => ({ ...prev, dueDate: undefined }));
                setDueDate(e.target.value);
              }}
            />
            <PaymentTermsField
              value={paymentTerms}
              onChange={setPaymentTerms}
            />
            <Select
              label="Billing kind"
              value={billingKind}
              onChange={(e) => setBillingKind(e.target.value)}
              options={Object.entries(INVOICE_BILLING_KIND_LABELS).map(
                ([value, label]) => ({ value, label }),
              )}
            />
            <Select
              label="Currency"
              required
              value={currency}
              error={fieldErrors.currency}
              onChange={(e) => {
                setFieldErrors((prev) => ({ ...prev, currency: undefined }));
                setCurrency(e.target.value);
              }}
              options={CURRENCY_OPTIONS}
            />
            {templates.length > 0 ? (
              <Select
                label="Document template"
                value={templateId}
                onChange={(e) => setTemplateId(e.target.value)}
                options={templates.map((t) => ({
                  value: t.id,
                  label: t.isDefault ? `${t.name} (Active)` : t.name,
                }))}
              />
            ) : null}
          </div>
        </section>

        <section className="rounded-xl border border-border-default bg-surface p-5 sm:p-6">
          <h3 className="text-sm font-semibold text-text-primary">
            Customer & billing
          </h3>
          <div className="mt-4 grid gap-4 sm:grid-cols-2">
            <div className="sm:col-span-2">
              <Textarea
                label="Billing address"
                value={billingAddress}
                onChange={(e) => setBillingAddress(e.target.value)}
                rows={3}
              />
            </div>
            <Input
              label="Lead email"
              type="email"
              value={leadEmail}
              onChange={(e) => setLeadEmail(e.target.value)}
            />
            <Input
              label="Mobile number"
              value={leadPhone}
              onChange={(e) => setLeadPhone(e.target.value)}
            />
            <Input
              label={
                taxCountry === "IN"
                  ? "GSTIN"
                  : taxCountry === "UK"
                    ? "VAT number"
                    : "Tax ID"
              }
              value={taxId}
              onChange={(e) => setTaxId(e.target.value)}
            />
          </div>
        </section>

        <section className="rounded-xl border border-border-default bg-surface p-5 sm:p-6">
          <h3 className="text-sm font-semibold text-text-primary">
            Global tax configuration
          </h3>
          <p className="mt-1 text-xs text-text-caption">
            Tax is calculated on the taxable amount (subtotal minus discount)
            using country rules. Selecting a deal pre-fills country, state,
            and tax ID from contact, company location, currency, and prior
            invoices.
          </p>
          {autofill?.tax.sourceNotes?.length ? (
            <ul className="mt-2 list-disc space-y-0.5 pl-4 text-xs text-text-caption">
              {autofill.tax.sourceNotes.map((note) => (
                <li key={note}>{note}</li>
              ))}
            </ul>
          ) : null}
          <div className="mt-4 grid gap-4 sm:grid-cols-2">
            <Select
              label="Country"
              required
              value={taxCountry}
              onChange={(e) => onTaxCountryChange(e.target.value)}
              options={countryOptions}
            />
            <div className="rounded-lg border border-border-default bg-subtle/40 px-3 py-2 text-sm text-text-primary sm:self-end">
              System:{" "}
              <span className="font-medium">{taxBreakdown.system}</span>
              {" · "}
              Effective rate:{" "}
              <span className="font-medium">{taxPercent}%</span>
            </div>
          </div>

          {taxCountry === "IN" ? (
            <div className="mt-4 grid gap-4 sm:grid-cols-2">
              <Select
                label="GST rate"
                required
                value={String(indiaGstRate)}
                onChange={(e) =>
                  setIndiaGstRate(Number(e.target.value) as IndiaGstRate)
                }
                options={indiaRateOptions}
              />
              <div className="rounded-lg border border-border-default bg-subtle/40 px-3 py-2 text-xs text-text-caption sm:self-end">
                {taxBreakdown.summaryLines.map((line) => (
                  <p key={line}>{line}</p>
                ))}
              </div>
              <Select
                label="Seller state"
                required
                value={sellerState}
                error={fieldErrors.sellerState}
                onChange={(e) => {
                  setFieldErrors((prev) => ({
                    ...prev,
                    sellerState: undefined,
                  }));
                  setSellerState(e.target.value);
                }}
                options={indiaStateOptions}
              />
              <Select
                label="Buyer state"
                required
                value={buyerState}
                error={fieldErrors.buyerState}
                onChange={(e) => {
                  setFieldErrors((prev) => ({
                    ...prev,
                    buyerState: undefined,
                  }));
                  setBuyerState(e.target.value);
                }}
                options={indiaStateOptions}
              />
            </div>
          ) : null}

          {taxCountry === "UK" ? (
            <div className="mt-4 grid gap-4 sm:grid-cols-2">
              <Select
                label="VAT category"
                value={ukVatCategory}
                onChange={(e) =>
                  setUkVatCategory(e.target.value as UkVatCategory)
                }
                options={ukVatOptions}
              />
              <div className="rounded-lg border border-border-default bg-subtle/40 px-3 py-2 text-xs text-text-caption sm:self-end">
                {taxBreakdown.summaryLines.map((line) => (
                  <p key={line}>{line}</p>
                ))}
                <p className="mt-1">
                  VAT rate depends on the specific goods/service and
                  applicable conditions.
                </p>
              </div>
            </div>
          ) : null}

          {taxCountry === "US" ? (
            <div className="mt-4 space-y-4">
              <p className="text-xs text-text-caption">
                The USA has no single nationwide sales tax. Enter only the
                jurisdiction components that apply (leave unused at 0). Total
                = state + county + city + special district.
              </p>
              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
                <Input
                  label="State sales tax (%)"
                  type="number"
                  min={0}
                  step="any"
                  value={usStatePercent}
                  onChange={(e) =>
                    setUsStatePercent(Number(e.target.value) || 0)
                  }
                />
                <Input
                  label="County sales tax (%)"
                  type="number"
                  min={0}
                  step="any"
                  value={usCountyPercent}
                  onChange={(e) =>
                    setUsCountyPercent(Number(e.target.value) || 0)
                  }
                />
                <Input
                  label="City sales tax (%)"
                  type="number"
                  min={0}
                  step="any"
                  value={usCityPercent}
                  onChange={(e) =>
                    setUsCityPercent(Number(e.target.value) || 0)
                  }
                />
                <Input
                  label="Special district (%)"
                  type="number"
                  min={0}
                  step="any"
                  value={usDistrictPercent}
                  onChange={(e) =>
                    setUsDistrictPercent(Number(e.target.value) || 0)
                  }
                />
              </div>
              <div className="rounded-lg border border-border-default bg-subtle/40 px-3 py-2 text-xs text-text-caption">
                {taxBreakdown.summaryLines.map((line) => (
                  <p key={line}>{line}</p>
                ))}
              </div>
            </div>
          ) : null}

          {taxBreakdown.components.length > 0 ? (
            <dl className="mt-4 grid gap-2 border-t border-border-default pt-4 text-sm sm:grid-cols-2">
              {taxBreakdown.components.map((c) => (
                <div
                  key={c.code}
                  className="flex items-center justify-between gap-3"
                >
                  <dt className="text-text-caption">
                    {c.label} ({c.percent}%)
                  </dt>
                  <dd className="font-medium text-text-primary">
                    {formatInvoiceMoney(String(c.amount), currency)}
                  </dd>
                </div>
              ))}
            </dl>
          ) : null}
        </section>

        <section
          className={`rounded-xl border bg-surface p-5 sm:p-6 ${
            fieldErrors.products
              ? "border-text-danger ring-1 ring-text-danger/30"
              : "border-border-default"
          }`}
        >
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <h3 className="text-sm font-semibold text-text-primary">
                Products & add-ons
                <span className="ml-0.5 text-text-danger" aria-hidden>
                  *
                </span>
              </h3>
              <p className="mt-1 text-xs text-text-caption">
                Add multiple products. Each product lists its add-ons
                underneath.
              </p>
              {fieldErrors.products ? (
                <p className="mt-1 text-xs text-text-danger" role="alert">
                  {fieldErrors.products}
                </p>
              ) : null}
            </div>
          </div>

          <div className="mt-4 space-y-4">
            {groups.length === 0 ? (
              <div className="rounded-xl border border-dashed border-border-default bg-subtle/40 px-5 py-10 text-center text-sm text-text-caption">
                {selectedProduct ? (
                  <>
                    <span className="font-medium text-text-primary">
                      {selectedProduct.name}
                    </span>{" "}
                    is selected. Click{" "}
                    <span className="font-medium text-text-primary">
                      Add product
                    </span>{" "}
                    to put it on this invoice (or save — we will add it for
                    you).
                  </>
                ) : (
                  <>
                    No products on this invoice yet. Pick a product below and
                    click{" "}
                    <span className="font-medium text-text-primary">
                      Add product
                    </span>
                    .
                  </>
                )}
              </div>
            ) : (
              breakdown.map(
                ({
                  group,
                  productTaxAmt,
                  productTotal,
                  addonRows,
                  groupSubtotal,
                  groupTax,
                  groupTotal,
                }) => (
                  <article
                    key={group.groupId}
                    className="overflow-hidden rounded-xl border border-border-default"
                  >
                    <div className="flex flex-wrap items-start justify-between gap-3 bg-subtle/60 px-4 py-3">
                      <div className="min-w-0">
                        <p className="text-sm font-semibold text-text-primary">
                          {group.product.name}
                        </p>
                        <p className="text-xs text-text-caption">
                          {group.product.description}
                        </p>
                      </div>
                      <button
                        type="button"
                        className="inline-flex size-8 items-center justify-center rounded-full text-text-caption hover:bg-surface hover:text-text-danger"
                        onClick={() => removeGroup(group.groupId)}
                        aria-label={`Remove ${group.product.name}`}
                      >
                        <Trash2 className="size-3.5" strokeWidth={1.75} />
                      </button>
                    </div>

                    <div className="grid gap-3 border-b border-border-default px-4 py-3 text-sm sm:grid-cols-5">
                      <div>
                        <p className="text-[11px] font-medium tracking-wide text-text-caption uppercase">
                          Qty
                        </p>
                        <Input
                          type="number"
                          min={0}
                          step="any"
                          className="mt-1"
                          value={group.product.quantity}
                          onChange={(e) =>
                            updateProductQty(
                              group.groupId,
                              Number(e.target.value),
                            )
                          }
                        />
                      </div>
                      <div>
                        <p className="text-[11px] font-medium tracking-wide text-text-caption uppercase">
                          Unit price
                        </p>
                        <p className="mt-2 font-medium text-text-primary">
                          {formatInvoiceMoney(
                            String(group.product.unitPrice),
                            currency,
                          )}
                        </p>
                      </div>
                      <div>
                        <p className="text-[11px] font-medium tracking-wide text-text-caption uppercase">
                          Tax ({group.product.taxPercent}%)
                        </p>
                        <p className="mt-2 font-medium text-text-primary">
                          {formatInvoiceMoney(String(productTaxAmt), currency)}
                        </p>
                      </div>
                      <div>
                        <p className="text-[11px] font-medium tracking-wide text-text-caption uppercase">
                          Price
                        </p>
                        <p className="mt-2 font-medium text-text-primary">
                          {formatInvoiceMoney(
                            String(group.product.amount),
                            currency,
                          )}
                        </p>
                      </div>
                      <div>
                        <p className="text-[11px] font-medium tracking-wide text-text-caption uppercase">
                          Line total
                        </p>
                        <p className="mt-2 font-semibold text-text-primary">
                          {formatInvoiceMoney(String(productTotal), currency)}
                        </p>
                      </div>
                    </div>

                    {addonRows.length > 0 ? (
                      <div className="bg-subtle/30 px-4 py-3">
                        <p className="text-[11px] font-medium tracking-wide text-text-caption uppercase">
                          Add-ons
                        </p>
                        <ul className="mt-2 space-y-2">
                          {addonRows.map(
                            ({ addon, taxAmt, total: addonTotal }) => {
                              const isFlat =
                                addon.description.includes("flat");
                              return (
                                <li
                                  key={addon.key}
                                  className="grid gap-2 rounded-lg border border-border-default bg-surface px-3 py-2 text-sm sm:grid-cols-[1.4fr_0.6fr_0.8fr_0.8fr_0.8fr]"
                                >
                                  <div>
                                    <p className="font-medium text-text-primary">
                                      {addon.name}
                                      <span className="ml-2 rounded-md bg-violet-0 px-1.5 py-0.5 text-[10px] font-medium text-brand">
                                        Add-on
                                      </span>
                                    </p>
                                    <p className="text-xs text-text-caption">
                                      {addon.description}
                                    </p>
                                  </div>
                                  <div>
                                    <p className="text-[10px] text-text-caption uppercase">
                                      Qty
                                    </p>
                                    {isFlat ? (
                                      <p className="mt-1 text-text-primary">
                                        1
                                      </p>
                                    ) : (
                                      <Input
                                        type="number"
                                        min={0}
                                        step="any"
                                        className="mt-1"
                                        value={addon.quantity}
                                        onChange={(e) =>
                                          updateAddonQty(
                                            addon.key,
                                            Number(e.target.value),
                                          )
                                        }
                                      />
                                    )}
                                  </div>
                                  <div>
                                    <p className="text-[10px] text-text-caption uppercase">
                                      Price
                                    </p>
                                    <p className="mt-1 font-medium text-text-primary">
                                      {formatInvoiceMoney(
                                        String(addon.amount),
                                        currency,
                                      )}
                                    </p>
                                  </div>
                                  <div>
                                    <p className="text-[10px] text-text-caption uppercase">
                                      Tax ({addon.taxPercent}%)
                                    </p>
                                    <p className="mt-1 font-medium text-text-primary">
                                      {formatInvoiceMoney(
                                        String(taxAmt),
                                        currency,
                                      )}
                                    </p>
                                  </div>
                                  <div>
                                    <p className="text-[10px] text-text-caption uppercase">
                                      Subtotal
                                    </p>
                                    <p className="mt-1 font-semibold text-text-primary">
                                      {formatInvoiceMoney(
                                        String(addonTotal),
                                        currency,
                                      )}
                                    </p>
                                  </div>
                                </li>
                              );
                            },
                          )}
                        </ul>
                      </div>
                    ) : null}

                    <div className="flex flex-wrap justify-end gap-4 border-t border-border-default bg-surface px-4 py-2.5 text-sm">
                      <span className="text-text-caption">
                        Product + add-ons:{" "}
                        <span className="font-medium text-text-primary">
                          {formatInvoiceMoney(String(groupSubtotal), currency)}
                        </span>
                      </span>
                      <span className="text-text-caption">
                        Tax:{" "}
                        <span className="font-medium text-text-primary">
                          {formatInvoiceMoney(String(groupTax), currency)}
                        </span>
                      </span>
                      <span className="font-semibold text-text-primary">
                        Group total{" "}
                        {formatInvoiceMoney(String(groupTotal), currency)}
                      </span>
                    </div>
                  </article>
                ),
              )
            )}
          </div>

          <div className="mt-5 rounded-xl border border-dashed border-border-default bg-subtle/40 p-4">
            <p className="text-sm font-medium text-text-primary">
              Add another product
            </p>
            <div className="mt-3 grid gap-3 sm:grid-cols-[1fr_100px_auto]">
              <Select
                value={selectedProductId}
                onChange={(e) => {
                  setSelectedProductId(e.target.value);
                  setAddonQtyById({});
                }}
                options={productOptions}
              />
              <Input
                type="number"
                min={0}
                step="any"
                value={productQty}
                onChange={(e) => setProductQty(Number(e.target.value))}
                aria-label="Product quantity"
              />
              <Button type="button" variant="brand" onClick={addProduct}>
                <Plus className="size-4" strokeWidth={2} />
                Add product
              </Button>
            </div>

            {selectedProduct?.productType === "customizable" &&
            selectedProduct.addons.length > 0 ? (
              <div className="mt-4">
                <p className="text-xs font-medium text-text-caption">
                  Optional add-ons for {selectedProduct.name} (applied when
                  you click Add product)
                </p>
                <ul className="mt-2 divide-y divide-border-default overflow-hidden rounded-lg border border-border-default bg-surface">
                  {selectedProduct.addons.map((addon) => {
                    const isFlat =
                      String(addon.pricingModel).toLowerCase() === "flat";
                    const qty = Number(addonQtyById[addon.id] ?? 0);
                    const included = qty > 0;
                    let preview = "—";
                    if (included) {
                      try {
                        preview = formatAddonAmount(
                          computeAddonAmount(addon, isFlat ? 1 : qty),
                          currency,
                        );
                      } catch {
                        preview = "Check";
                      }
                    }
                    return (
                      <li
                        key={addon.id}
                        className="flex flex-wrap items-center gap-3 px-4 py-3"
                      >
                        <div className="min-w-0 flex-1">
                          <p className="text-sm font-medium text-text-primary">
                            {addon.name}
                            {isFlat ? (
                              <span className="ml-2 rounded-md bg-subtle px-1.5 py-0.5 text-[10px] font-medium text-text-caption">
                                Flat
                              </span>
                            ) : null}
                          </p>
                          <p className="text-xs text-text-caption">
                            {isFlat
                              ? "Include or skip"
                              : `${addon.pricingModel.replace("_", " ")}${
                                  addon.unitLabel
                                    ? ` · ${addon.unitLabel}`
                                    : ""
                                }`}
                          </p>
                        </div>
                        {isFlat ? (
                          <button
                            type="button"
                            role="switch"
                            aria-checked={included}
                            onClick={() =>
                              setAddonQtyById((prev) => ({
                                ...prev,
                                [addon.id]: included ? 0 : 1,
                              }))
                            }
                            className={`relative inline-flex h-8 w-[4.5rem] shrink-0 items-center rounded-full px-1 text-[11px] font-medium transition-colors ${
                              included
                                ? "bg-brand text-text-on-dark"
                                : "bg-neutral-200 text-text-secondary"
                            }`}
                          >
                            <span
                              className={`absolute size-6 rounded-full bg-surface shadow transition-transform ${
                                included
                                  ? "translate-x-[2.1rem]"
                                  : "translate-x-0"
                              }`}
                            />
                            <span
                              className={`relative z-10 w-full text-center ${
                                included ? "pr-5" : "pl-5"
                              }`}
                            >
                              {included ? "Yes" : "No"}
                            </span>
                          </button>
                        ) : (
                          <Input
                            type="number"
                            min={0}
                            step="any"
                            className="w-24"
                            value={addonQtyById[addon.id] ?? 0}
                            onChange={(e) =>
                              setAddonQtyById((prev) => ({
                                ...prev,
                                [addon.id]: Number(e.target.value),
                              }))
                            }
                          />
                        )}
                        <span className="w-28 text-right text-sm font-medium text-text-primary">
                          {preview}
                        </span>
                      </li>
                    );
                  })}
                </ul>
              </div>
            ) : null}
          </div>
        </section>

        <div className="grid gap-6 lg:grid-cols-[1.1fr_0.9fr]">
          <section className="rounded-xl border border-border-default bg-surface p-5 sm:p-6">
            <h3 className="text-sm font-semibold text-text-primary">
              Notes to customer
            </h3>
            <Textarea
              className="mt-3"
              rows={5}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Payment instructions or message…"
            />
          </section>

          <section className="rounded-xl border border-border-default bg-surface p-5 sm:p-6">
            <h3 className="text-sm font-semibold text-text-primary">
              Invoice total
            </h3>

            <div className="mt-4 max-h-80 space-y-4 overflow-y-auto pr-1">
              {breakdown.length === 0 ? (
                <p className="text-sm text-text-caption">
                  Add a product to see price, tax, and add-on totals here.
                </p>
              ) : (
                breakdown.map(
                  ({
                    group,
                    productTaxAmt,
                    productTotal,
                    addonRows,
                    groupTotal,
                  }) => (
                    <div
                      key={group.groupId}
                      className="rounded-lg border border-border-default px-3 py-2.5 text-sm"
                    >
                      <div className="flex items-start justify-between gap-2">
                        <p className="font-medium text-text-primary">
                          {group.product.name}
                        </p>
                        <p className="shrink-0 font-semibold text-text-primary">
                          {formatInvoiceMoney(String(productTotal), currency)}
                        </p>
                      </div>
                      <p className="mt-1 text-xs text-text-caption">
                        Price{" "}
                        {formatInvoiceMoney(
                          String(group.product.amount),
                          currency,
                        )}{" "}
                        · Tax {group.product.taxPercent}%{" "}
                        {formatInvoiceMoney(String(productTaxAmt), currency)}
                      </p>

                      {addonRows.length > 0 ? (
                        <ul className="mt-2 space-y-1.5 border-t border-border-default pt-2">
                          {addonRows.map(
                            ({ addon, taxAmt, total: addonTotal }) => (
                              <li key={addon.key} className="text-xs">
                                <div className="flex justify-between gap-2">
                                  <span className="text-text-secondary">
                                    + {addon.name}
                                  </span>
                                  <span className="font-medium text-text-primary">
                                    {formatInvoiceMoney(
                                      String(addonTotal),
                                      currency,
                                    )}
                                  </span>
                                </div>
                                <p className="text-text-caption">
                                  Price{" "}
                                  {formatInvoiceMoney(
                                    String(addon.amount),
                                    currency,
                                  )}{" "}
                                  · Tax {addon.taxPercent}%{" "}
                                  {formatInvoiceMoney(
                                    String(taxAmt),
                                    currency,
                                  )}
                                </p>
                              </li>
                            ),
                          )}
                        </ul>
                      ) : null}

                      <p className="mt-2 text-right text-xs font-medium text-text-caption">
                        Product block{" "}
                        <span className="text-text-primary">
                          {formatInvoiceMoney(String(groupTotal), currency)}
                        </span>
                      </p>
                    </div>
                  ),
                )
              )}
            </div>

            <dl className="mt-4 space-y-3 border-t border-border-default pt-4 text-sm">
              <div className="flex items-center justify-between gap-3">
                <dt className="text-text-caption">Subtotal (ex tax)</dt>
                <dd className="font-medium text-text-primary">
                  {formatInvoiceMoney(String(merchandiseSubtotal), currency)}
                </dd>
              </div>
              <div className="flex items-start justify-between gap-3">
                <dt className="pt-2.5 text-text-caption">Discount</dt>
                <dd className="flex flex-col items-end gap-1">
                  <div className="flex items-center gap-1.5">
                    <Input
                      type="number"
                      min={0}
                      max={discountMode === "percent" ? 100 : undefined}
                      step="any"
                      className="w-24"
                      value={discountValue}
                      onChange={(e) =>
                        setDiscountValue(Number(e.target.value) || 0)
                      }
                      aria-label="Discount value"
                    />
                    <DropdownSelect
                      className="max-w-[13.5rem]"
                      value={discountMode}
                      options={[
                        {
                          value: "percent",
                          label: "% — Percentage discount",
                        },
                        {
                          value: "fixed",
                          label: `${currencyDiscountSymbol(currency)} — Fixed amount discount`,
                        },
                      ]}
                      size="lg"
                      buttonClassName="text-text-primary focus:ring-2 focus:ring-border-focus/20"
                      onChange={(value) =>
                        setDiscountMode(value === "fixed" ? "fixed" : "percent")
                      }
                      aria-label="Discount type"
                    />
                  </div>
                  {discountAmount > 0 ? (
                    <p className="text-[11px] text-text-caption">
                      −{formatInvoiceMoney(String(discountAmount), currency)}
                    </p>
                  ) : null}
                </dd>
              </div>
              <div className="flex items-center justify-between gap-3">
                <dt className="text-text-caption">Taxable amount</dt>
                <dd className="font-medium text-text-primary">
                  {formatInvoiceMoney(String(taxableAmount), currency)}
                </dd>
              </div>
              {taxBreakdown.components.map((c) => (
                <div
                  key={c.code}
                  className="flex items-center justify-between gap-3"
                >
                  <dt className="text-text-caption">
                    {c.label} ({c.percent}%)
                  </dt>
                  <dd className="font-medium text-text-primary">
                    {formatInvoiceMoney(String(c.amount), currency)}
                  </dd>
                </div>
              ))}
              <div className="flex items-center justify-between gap-3">
                <dt className="text-text-caption">
                  Tax total · {taxBreakdown.system} ({taxPercent}%)
                </dt>
                <dd className="font-medium text-text-primary">
                  {formatInvoiceMoney(String(taxTotal), currency)}
                </dd>
              </div>
              <div className="flex items-end justify-between gap-3 border-t border-border-default pt-3">
                <dt className="text-xs font-medium tracking-wide text-text-caption uppercase">
                  Amount due
                </dt>
                <dd className="text-2xl font-semibold text-text-primary">
                  {formatInvoiceMoney(String(total), currency)}
                </dd>
              </div>
            </dl>
          </section>
        </div>

        <div className="flex flex-wrap justify-end gap-2 border-t border-border-default pt-4">
          <Link to="/finance">
            <Button type="button" variant="secondary" disabled={pending}>
              Cancel
            </Button>
          </Link>
          <Button
            type="button"
            variant="secondary"
            disabled={pending}
            onClick={() => void submit("draft")}
          >
            Save as draft
          </Button>
          <Button
            type="button"
            variant="primary"
            disabled={pending}
            onClick={() => void submit("sent")}
          >
            Review and send
          </Button>
        </div>
      </div>
    </FinanceShell>
  );
}
