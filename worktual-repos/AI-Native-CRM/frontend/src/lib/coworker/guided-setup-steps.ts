/**
 * Step maps for guided chat create — mirror of agent next_*_prompt order.
 * Panel is a read-only progress mirror; chat owns questioning.
 */

export type SetupStepDef<T> = {
  id: string;
  label: string;
  required: boolean;
  /** Return display value when filled, else null. */
  getValue: (draft: T) => string | null;
};

export type ResolvedSetupStep = {
  id: string;
  label: string;
  required: boolean;
  value: string | null;
  status: "completed" | "current" | "pending";
};

import { humanLabel } from "@/lib/coworker/human-name";

function trimStr(v: unknown): string {
  return typeof v === "string" ? v.trim() : "";
}

export function resolveSetupSteps<T>(
  steps: SetupStepDef<T>[],
  draft: T,
): ResolvedSetupStep[] {
  const withValues = steps.map((s) => ({
    id: s.id,
    label: s.label,
    required: s.required,
    value: s.getValue(draft),
  }));

  let currentAssigned = false;
  return withValues.map((s) => {
    if (s.value) {
      return { ...s, status: "completed" as const };
    }
    if (!currentAssigned) {
      currentAssigned = true;
      return { ...s, status: "current" as const };
    }
    return { ...s, status: "pending" as const };
  });
}

export function setupProgress(resolved: ResolvedSetupStep[]) {
  const trackable = resolved.filter((s) => s.id !== "create");
  const filled = trackable.filter((s) => s.status === "completed").length;
  const total = trackable.length;
  const requiredReady = resolved
    .filter((s) => s.required && s.id !== "create")
    .every((s) => s.status === "completed");
  return {
    filled,
    total,
    left: Math.max(0, total - filled),
    ratio: total === 0 ? 0 : filled / total,
    percent: total === 0 ? 0 : Math.round((filled / total) * 100),
    ready: requiredReady,
  };
}

/* ── Contact ───────────────────────────────────────────────────────── */

export type ContactSetupDraft = {
  firstName?: string;
  lastName?: string;
  email?: string;
  phone?: string;
  title?: string;
  companyId?: string;
  companyName?: string;
  city?: string;
  country?: string;
  leadSource?: string;
  skippedOptional?: string;
};

function contactSkipped(draft: ContactSetupDraft, field: string): boolean {
  const raw = trimStr(draft.skippedOptional);
  if (!raw) return false;
  const keys = new Set(
    raw.split(",").map((p) => {
      const k = p.trim();
      return k === "companyName" ? "company" : k;
    }),
  );
  return keys.has(field);
}

export function contactSetupSteps(
  companyLabel?: (id: string) => string | null,
): SetupStepDef<ContactSetupDraft>[] {
  return [
    {
      id: "firstName",
      label: "First name",
      required: true,
      getValue: (d) => trimStr(d.firstName) || null,
    },
    {
      id: "lastName",
      label: "Last name",
      required: false,
      getValue: (d) =>
        trimStr(d.lastName) || (contactSkipped(d, "lastName") ? "Skipped" : null),
    },
    {
      id: "email",
      label: "Email",
      required: false,
      getValue: (d) =>
        trimStr(d.email) || (contactSkipped(d, "email") ? "Skipped" : null),
    },
    {
      id: "phone",
      label: "Phone",
      required: false,
      getValue: (d) =>
        trimStr(d.phone) || (contactSkipped(d, "phone") ? "Skipped" : null),
    },
    {
      id: "company",
      label: "Company",
      required: false,
      getValue: (d) => {
        const name = trimStr(d.companyName);
        if (name) return name;
        const id = trimStr(d.companyId);
        if (id && companyLabel) return companyLabel(id) || id;
        if (id) return id;
        return contactSkipped(d, "company") ? "Skipped" : null;
      },
    },
    {
      id: "title",
      label: "Title",
      required: false,
      getValue: (d) =>
        trimStr(d.title) || (contactSkipped(d, "title") ? "Skipped" : null),
    },
    {
      id: "city",
      label: "City",
      required: false,
      getValue: (d) =>
        trimStr(d.city) || (contactSkipped(d, "city") ? "Skipped" : null),
    },
    {
      id: "country",
      label: "Country",
      required: false,
      getValue: (d) =>
        trimStr(d.country) || (contactSkipped(d, "country") ? "Skipped" : null),
    },
  ];
}

export function contactSetupHeadline(d: ContactSetupDraft): string {
  const name = [trimStr(d.firstName), trimStr(d.lastName)]
    .filter(Boolean)
    .join(" ");
  return name || "New contact";
}

/* ── Company ───────────────────────────────────────────────────────── */

export type CompanySetupDraft = {
  name?: string;
  locationName?: string;
  locationAddress?: string;
  locationType?: string;
  domain?: string;
  industry?: string;
  employeeCount?: string;
  linkedinUrl?: string;
  skippedOptional?: string;
};

function companySkipped(draft: CompanySetupDraft, field: string): boolean {
  const raw = trimStr(draft.skippedOptional);
  if (!raw) return false;
  return raw.split(",").some((p) => p.trim() === field);
}

function companyOpt(
  d: CompanySetupDraft,
  field: string,
  value: string | null,
): string | null {
  if (value) return value;
  return companySkipped(d, field) ? "Skipped" : null;
}

export const companySetupSteps: SetupStepDef<CompanySetupDraft>[] = [
  {
    id: "name",
    label: "Company name",
    required: true,
    getValue: (d) => trimStr(d.name) || null,
  },
  {
    id: "locationName",
    label: "Location name",
    required: true,
    getValue: (d) => trimStr(d.locationName) || null,
  },
  {
    id: "locationAddress",
    label: "Address",
    required: false,
    getValue: (d) =>
      companyOpt(d, "locationAddress", trimStr(d.locationAddress) || null),
  },
  {
    id: "locationType",
    label: "Location type",
    required: false,
    getValue: (d) => {
      const t = trimStr(d.locationType).toLowerCase();
      if (t === "hq") return "HQ";
      if (t === "branch") return "Branch";
      return companyOpt(d, "locationType", t || null);
    },
  },
  {
    id: "domain",
    label: "Domain",
    required: false,
    getValue: (d) => companyOpt(d, "domain", trimStr(d.domain) || null),
  },
  {
    id: "industry",
    label: "Industry",
    required: false,
    getValue: (d) => companyOpt(d, "industry", trimStr(d.industry) || null),
  },
  {
    id: "employeeCount",
    label: "Employees",
    required: false,
    getValue: (d) =>
      companyOpt(d, "employeeCount", trimStr(d.employeeCount) || null),
  },
  {
    id: "linkedinUrl",
    label: "LinkedIn",
    required: false,
    getValue: (d) =>
      companyOpt(d, "linkedinUrl", trimStr(d.linkedinUrl) || null),
  },
];

export function companySetupHeadline(d: CompanySetupDraft): string {
  return trimStr(d.name) || "New company";
}

/* ── Location ──────────────────────────────────────────────────────── */

export type LocationSetupDraft = {
  name?: string;
  type?: string;
  address?: string;
  industry?: string;
};

export const locationSetupSteps: SetupStepDef<LocationSetupDraft>[] = [
  {
    id: "name",
    label: "Location name",
    required: true,
    getValue: (d) => trimStr(d.name) || null,
  },
  {
    id: "type",
    label: "Type",
    required: false,
    getValue: (d) => {
      const t = trimStr(d.type).toLowerCase();
      if (t === "hq") return "HQ";
      if (t === "branch") return "Branch";
      return t || null;
    },
  },
    {
      id: "address",
      label: "Address",
      required: false,
      getValue: (d) => trimStr(d.address) || null,
    },
    {
      id: "industry",
      label: "Industry",
      required: false,
      getValue: (d) => trimStr(d.industry) || null,
    },
  ];

export function locationSetupHeadline(d: LocationSetupDraft): string {
  return trimStr(d.name) || "New location";
}

/* ── Deal ──────────────────────────────────────────────────────────── */

export type DealSetupDraft = {
  title?: string;
  companyId?: string;
  companyName?: string;
  amount?: string;
  stage?: string;
  contactId?: string;
  contactName?: string;
  notes?: string;
  expectedCloseDate?: string;
};

export function dealSetupSteps(
  companyLabel?: (id: string) => string | null,
  contactLabel?: (id: string) => string | null,
): SetupStepDef<DealSetupDraft>[] {
  return [
    {
      id: "title",
      label: "Deal title",
      required: true,
      getValue: (d) => trimStr(d.title) || null,
    },
    {
      id: "company",
      label: "Company",
      required: true,
      getValue: (d) => {
        const name = humanLabel(d.companyName);
        if (name) return name;
        const id = trimStr(d.companyId);
        if (id && companyLabel) return humanLabel(companyLabel(id));
        return null;
      },
    },
    {
      id: "amount",
      label: "Amount",
      required: false,
      getValue: (d) => trimStr(d.amount) || null,
    },
    {
      id: "stage",
      label: "Stage",
      required: false,
      getValue: (d) => {
        const s = trimStr(d.stage);
        return s ? s.replace(/_/g, " ") : null;
      },
    },
    {
      id: "contact",
      label: "Contact",
      required: false,
      getValue: (d) => {
        const named = humanLabel(d.contactName);
        if (named) return named;
        const id = trimStr(d.contactId);
        if (!id) return null;
        if (contactLabel) return humanLabel(contactLabel(id));
        return null;
      },
    },
    {
      id: "expectedCloseDate",
      label: "Close date",
      required: false,
      getValue: (d) => trimStr(d.expectedCloseDate) || null,
    },
    {
      id: "notes",
      label: "Notes",
      required: false,
      getValue: (d) => trimStr(d.notes) || null,
    },
  ];
}

export function dealSetupHeadline(d: DealSetupDraft): string {
  return trimStr(d.title) || "New deal";
}

/* ── Product ───────────────────────────────────────────────────────── */

export type ProductSetupDraft = {
  name?: string;
  sku?: string;
  price?: string;
  maxDiscountPercent?: string;
  currency?: string;
  brand?: string;
  category?: string;
  stockOnHand?: string;
  productUrl?: string;
  productType?: string;
  billingType?: string;
  billingFrequency?: string;
  description?: string;
  tags?: string;
  imageUrl?: string;
  galleryUrls?: string;
  offers?: Array<{ name?: string }>;
  addons?: Array<{ name?: string }>;
  skippedOptional?: string;
};

function productSkipped(draft: ProductSetupDraft, field: string): boolean {
  const raw = trimStr(draft.skippedOptional);
  if (!raw) return false;
  return raw
    .split(",")
    .map((p) => p.trim())
    .includes(field);
}

function productOpt(
  d: ProductSetupDraft,
  field: string,
  value: string | null,
): string | null {
  if (value) return value;
  return productSkipped(d, field) ? "Skipped" : null;
}

export const productSetupSteps: SetupStepDef<ProductSetupDraft>[] = [
  {
    id: "name",
    label: "Product name",
    required: true,
    getValue: (d) => trimStr(d.name) || null,
  },
  {
    id: "sku",
    label: "SKU",
    required: true,
    getValue: (d) => trimStr(d.sku) || null,
  },
  {
    id: "price",
    label: "Price",
    required: false,
    getValue: (d) => productOpt(d, "price", trimStr(d.price) || null),
  },
  {
    id: "currency",
    label: "Currency",
    required: false,
    getValue: (d) => productOpt(d, "currency", trimStr(d.currency) || null),
  },
  {
    id: "productType",
    label: "Product type",
    required: false,
    getValue: (d) =>
      productOpt(
        d,
        "productType",
        trimStr(d.productType).replace(/_/g, " ") || null,
      ),
  },
  {
    id: "billingType",
    label: "Billing",
    required: false,
    getValue: (d) => {
      const t = trimStr(d.billingType).replace(/_/g, " ");
      const f = trimStr(d.billingFrequency);
      const billingSkipped =
        productSkipped(d, "billingType") ||
        productSkipped(d, "billingFrequency");
      // Recurring without frequency is still the active chat slot.
      if (t === "recurring" && !f && !billingSkipped) {
        return null;
      }
      if (t === "recurring" && !f && productSkipped(d, "billingFrequency")) {
        return "recurring";
      }
      const value = t && f ? `${t} · ${f}` : t || f || null;
      return productOpt(d, "billingType", value);
    },
  },
  {
    id: "maxDiscount",
    label: "Max discount %",
    required: false,
    getValue: (d) =>
      productOpt(d, "maxDiscount", trimStr(d.maxDiscountPercent) || null),
  },
  {
    id: "brand",
    label: "Brand",
    required: false,
    getValue: (d) => productOpt(d, "brand", trimStr(d.brand) || null),
  },
  {
    id: "stockOnHand",
    label: "Stock on hand",
    required: false,
    getValue: (d) =>
      productOpt(d, "stockOnHand", trimStr(d.stockOnHand) || null),
  },
  {
    id: "productUrl",
    label: "Product URL",
    required: false,
    getValue: (d) =>
      productOpt(d, "productUrl", trimStr(d.productUrl) || null),
  },
  {
    id: "category",
    label: "Category",
    required: false,
    getValue: (d) => productOpt(d, "category", trimStr(d.category) || null),
  },
  {
    id: "description",
    label: "Description",
    required: false,
    getValue: (d) =>
      productOpt(d, "description", trimStr(d.description) || null),
  },
  {
    id: "tags",
    label: "Tags",
    required: false,
    getValue: (d) => productOpt(d, "tags", trimStr(d.tags) || null),
  },
  {
    id: "image",
    label: "Image",
    required: false,
    getValue: (d) =>
      productOpt(
        d,
        "image",
        trimStr(d.imageUrl) ||
          (trimStr(d.galleryUrls) ? "gallery set" : null),
      ),
  },
  {
    id: "offers",
    label: "Offers",
    required: false,
    getValue: (d) => {
      const pt = trimStr(d.productType);
      // Fixed/standard products never collect offers — don't steal "Up next".
      if (pt && pt !== "customizable") return "n/a";
      if (!pt) return null;
      if (productSkipped(d, "offers")) return "Skipped";
      const n = d.offers?.filter((o) => trimStr(o.name)).length ?? 0;
      return n > 0 ? `${n} offer(s)` : null;
    },
  },
  {
    id: "addons",
    label: "Addons",
    required: false,
    getValue: (d) => {
      const pt = trimStr(d.productType);
      if (pt && pt !== "customizable") return "n/a";
      if (!pt) return null;
      if (productSkipped(d, "addons")) return "Skipped";
      const n = d.addons?.filter((a) => trimStr(a.name)).length ?? 0;
      return n > 0 ? `${n} addon(s)` : null;
    },
  },
];

export function productSetupHeadline(d: ProductSetupDraft): string {
  return trimStr(d.name) || "New product";
}

/* ── Quote ─────────────────────────────────────────────────────────── */

export type QuoteSetupDraft = {
  dealId?: string;
  productId?: string;
  offerId?: string;
  quantity?: string;
  discountPct?: string;
};

export function quoteSetupSteps(
  dealLabel?: (id: string) => string | null,
  productLabel?: (id: string) => string | null,
  offerLabel?: (id: string) => string | null,
): SetupStepDef<QuoteSetupDraft>[] {
  return [
    {
      id: "deal",
      label: "Deal",
      required: true,
      getValue: (d) => {
        const id = trimStr(d.dealId);
        if (!id) return null;
        if (dealLabel) return dealLabel(id) || id;
        return id;
      },
    },
    {
      id: "product",
      label: "Product",
      required: true,
      getValue: (d) => {
        const id = trimStr(d.productId);
        if (!id) return null;
        if (productLabel) return productLabel(id) || id;
        return id;
      },
    },
    {
      id: "offer",
      label: "Plan / offer",
      required: false,
      getValue: (d) => {
        const id = trimStr(d.offerId);
        if (!id) return null;
        if (offerLabel) return offerLabel(id) || id;
        return id;
      },
    },
    {
      id: "quantity",
      label: "Quantity",
      required: false,
      getValue: (d) => {
        // Defaults (qty 1) must not look "complete" before deal/product exist.
        if (!trimStr(d.dealId) || !trimStr(d.productId)) return null;
        const v = trimStr(d.quantity);
        return v && v !== "1" ? v : v || null;
      },
    },
    {
      id: "discount",
      label: "Discount %",
      required: false,
      getValue: (d) => {
        if (!trimStr(d.dealId) || !trimStr(d.productId)) return null;
        const v = trimStr(d.discountPct);
        if (!v || v === "0") return null;
        return `${v}%`;
      },
    },
  ];
}

export function quoteSetupHeadline(d: QuoteSetupDraft): string {
  return trimStr(d.dealId) ? "Quote draft" : "New quote";
}

/* ── Invoice ───────────────────────────────────────────────────────── */

export type InvoiceSetupDraft = {
  dealId?: string;
  currency?: string;
  notes?: string;
  paymentTerms?: string;
  productId?: string;
  quantity?: string;
  issueDate?: string;
  dueDate?: string;
};

export function invoiceSetupSteps(
  dealLabel?: (id: string) => string | null,
  productLabel?: (id: string) => string | null,
): SetupStepDef<InvoiceSetupDraft>[] {
  return [
    {
      id: "deal",
      label: "Deal",
      required: true,
      getValue: (d) => {
        const id = trimStr(d.dealId);
        if (!id) return null;
        if (dealLabel) return dealLabel(id) || id;
        return id;
      },
    },
    {
      id: "product",
      label: "Product",
      required: true,
      getValue: (d) => {
        const id = trimStr(d.productId);
        if (!id) return null;
        if (productLabel) return productLabel(id) || id;
        return id;
      },
    },
    {
      id: "quantity",
      label: "Quantity",
      required: false,
      getValue: (d) => {
        if (!trimStr(d.productId)) return null;
        return trimStr(d.quantity) || null;
      },
    },
    {
      id: "currency",
      label: "Currency",
      required: false,
      getValue: (d) => trimStr(d.currency) || null,
    },
    {
      id: "dates",
      label: "Dates",
      required: false,
      getValue: (d) => {
        const issue = trimStr(d.issueDate);
        const due = trimStr(d.dueDate);
        if (issue && due) return `${issue} → ${due}`;
        return issue || due || null;
      },
    },
    {
      id: "paymentTerms",
      label: "Payment terms",
      required: false,
      getValue: (d) => trimStr(d.paymentTerms) || null,
    },
    {
      id: "notes",
      label: "Notes",
      required: false,
      getValue: (d) => trimStr(d.notes) || null,
    },
  ];
}

export function invoiceSetupHeadline(d: InvoiceSetupDraft): string {
  return trimStr(d.dealId) ? "Invoice draft" : "New invoice";
}

/* ── Activity ──────────────────────────────────────────────────────── */

export type ActivitySetupDraft = {
  contactId?: string;
  type?: string;
  subject?: string;
  dueAt?: string;
  body?: string;
  skippedOptional?: string;
};

function activitySkipped(draft: ActivitySetupDraft, field: string): boolean {
  const raw = trimStr(draft.skippedOptional);
  if (!raw) return false;
  return raw.split(",").some((p) => p.trim() === field);
}

export function activitySetupSteps(
  contactLabel?: (id: string) => string | null,
): SetupStepDef<ActivitySetupDraft>[] {
  return [
    {
      id: "contact",
      label: "Contact",
      required: true,
      getValue: (d) => {
        const id = trimStr(d.contactId);
        if (!id) return null;
        if (contactLabel) return contactLabel(id) || id;
        return id;
      },
    },
    {
      id: "type",
      label: "Type",
      required: false,
      getValue: (d) =>
        trimStr(d.type) || (activitySkipped(d, "type") ? "Skipped" : null),
    },
    {
      id: "subject",
      label: "Subject",
      required: true,
      getValue: (d) => trimStr(d.subject) || null,
    },
    {
      id: "dueAt",
      label: "Due",
      required: false,
      getValue: (d) =>
        trimStr(d.dueAt) || (activitySkipped(d, "dueAt") ? "Skipped" : null),
    },
    {
      id: "body",
      label: "Notes",
      required: false,
      getValue: (d) =>
        trimStr(d.body) || (activitySkipped(d, "body") ? "Skipped" : null),
    },
  ];
}

export function activitySetupHeadline(d: ActivitySetupDraft): string {
  return trimStr(d.subject) || "New activity";
}
