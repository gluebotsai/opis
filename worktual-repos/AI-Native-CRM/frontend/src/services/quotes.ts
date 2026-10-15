import { api } from "./api";

export type QuoteListItem = {
  id: string;
  number: string;
  status: string;
  total: string;
  currency: string;
  dealId: string;
  dealTitle: string;
  updatedAt: string;
  proposalLabel?: string | null;
  approvalStatus?: string | null;
};

export type DealQuoteRow = {
  id: string;
  number: string;
  status: string;
  approvalStatus?: string | null;
  total: string;
  currency: string;
  updatedAt: string;
  proposalLabel: string | null;
  orderNumber: string | null;
  orderStatus: string | null;
  invoiceId: string | null;
  invoiceNumber: string | null;
  invoiceStatus: string | null;
};

export type QuoteFormOffer = {
  id: string;
  name: string;
  code: string | null;
  meterKey: string | null;
  includedQty: number | null;
  listPrice: string | null;
  currency: string;
};

export type QuoteFormAddon = {
  id: string;
  name: string;
  unitLabel: string | null;
  meterKey: string | null;
  isOverage: boolean;
  pricingModel: string;
  listPrice: string | null;
  flatPrice: string | null;
  unitPrice: string | null;
  stepSize: number | null;
  stepPrice: string | null;
  currency: string;
  tiers: Array<{
    minQty: number;
    maxQty: number | null;
    unitPrice: number;
  }>;
};

export type QuoteFormProduct = {
  id: string;
  name: string;
  sku: string | null;
  productType: "fixed" | "customizable";
  currency: string;
  price: string | null;
  basePrice: string | null;
  listPrice: string | null;
  offers: QuoteFormOffer[];
  addons: QuoteFormAddon[];
};

export type QuoteDetailLine = {
  id: string;
  productId: string | null;
  name: string;
  quantity: string;
  unitPrice: string;
  amount: string;
  sortOrder: number;
};

export type QuoteDetail = {
  id: string;
  number: string;
  version: number;
  status: string;
  currency: string;
  subtotal: string;
  discountPct: string;
  total: string;
  amountInWords?: string;
  notes: string | null;
  validUntil: string | null;
  sentAt: string | null;
  acceptedAt: string | null;
  approvalStatus: string;
  approvalNote?: string | null;
  approvedAt: string | null;
  isApproved: boolean;
  /** Most restrictive product discount cap on this quote's lines, or null if none apply. */
  discountLimitPct: number | null;
  dealId: string;
  dealTitle: string;
  customerName: string | null;
  companyName: string | null;
  vendorName: string | null;
  documentSections: QuoteDocumentSection[];
  templateId: string | null;
  templateName: string | null;
  blueprint?: QuoteTemplate["blueprint"];
  assets?: QuoteTemplate["assets"];
  proposalLabel: string | null;
  lines: QuoteDetailLine[];
  createdAt: string;
  updatedAt: string;
};

export type QuoteDocumentSection = {
  id: string;
  key: string;
  title: string;
  body: string;
  sortOrder: number;
};

export type QuoteTemplate = {
  id: string;
  name: string;
  code: string | null;
  kind: string;
  isDefault: boolean;
  sections: QuoteDocumentSection[];
  blueprint?: {
    version: number;
    html: string;
    css: string;
    mode?: string;
    chrome?: boolean;
    theme?: Record<string, string>;
    slots?: Array<{ key: string; label: string }>;
  } | null;
  assets?: Array<{
    id: string;
    kind: "logo" | "image";
    mime: string;
    dataBase64: string;
  }>;
  updatedAt: string;
};

export async function fetchQuotesPage(params: {
  page?: number;
  dealId?: string;
  status?: string;
}) {
  const { data } = await api.get<{
    ok: true;
    items: QuoteListItem[];
    pagination: {
      page: number;
      pageSize: number;
      total: number;
      totalPages: number;
    };
  }>("/api/sales/quotes", { params });
  return data;
}

export async function fetchQuote(id: string) {
  const { data } = await api.get<{
    ok: true;
    quote: QuoteDetail;
  } | { ok: false; error: string }>(`/api/sales/quotes/${id}`);
  return data;
}

export async function downloadQuotePdf(id: string) {
  const response = await api.get(`/api/sales/quotes/${id}/pdf`, {
    responseType: "blob",
  });
  return response.data as Blob;
}

export async function downloadQuoteCsv(id: string) {
  const response = await api.get(`/api/sales/quotes/${id}/csv`, {
    responseType: "blob",
  });
  return response.data as Blob;
}

export async function downloadQuoteDocx(id: string) {
  const response = await api.get(`/api/sales/quotes/${id}/docx`, {
    responseType: "blob",
  });
  return response.data as Blob;
}

export async function fetchDealQuotes(dealId: string) {
  const { data } = await api.get<{ ok: true; items: DealQuoteRow[] }>(
    `/api/sales/deals/${dealId}/quotes`,
  );
  return data;
}

export type PendingDiscountApproval = {
  id: string;
  number: string;
  dealId: string;
  dealTitle: string;
  contactName: string | null;
  companyName: string | null;
  discountPct: string;
  limitPct: number | null;
  total: string;
  currency: string;
  updatedAt: string;
};

export async function fetchPendingDiscountApprovals() {
  const { data } = await api.get<
    { ok: true; items: PendingDiscountApproval[] } | { ok: false; error: string }
  >("/api/sales/quotes/pending-discount-approvals");
  return data;
}

export async function fetchQuoteFormOptions() {
  const { data } = await api.get<{
    ok: true;
    deals: Array<{ id: string; title: string }>;
    products: QuoteFormProduct[];
  }>("/api/sales/quotes/form-options");
  return data;
}

export async function createQuoteFromRequirement(body: {
  dealId: string;
  requirementPdfBase64: string;
  requirementFilename?: string | null;
}) {
  const { data } = await api.post("/api/sales/quotes/from-requirement", body, {
    timeout: 180_000,
  });
  return data as { ok: true; id: string } | { ok: false; error: string };
}

export async function createQuote(body: {
  dealId: string;
  discountPct?: number;
  notes?: string | null;
  proposalId?: string | null;
  currency?: string | null;
  fromTemplate?: boolean;
  templateId?: string | null;
  lines: Array<{
    productId?: string | null;
    name: string;
    quantity: number;
    unitPrice: number;
  }>;
}) {
  const { data } = await api.post("/api/sales/quotes", body);
  return data as { ok: true; id: string } | { ok: false; error: string };
}

export async function rewriteQuoteSection(
  id: string,
  body: { sectionKey: string; instruction?: string },
) {
  const { data } = await api.post(
    `/api/sales/quotes/${id}/rewrite-section`,
    body,
    { timeout: 90_000 },
  );
  return data as
    | { ok: true; id: string; warnings?: string[] }
    | { ok: false; error: string };
}

export async function updateQuoteDocumentAsset(
  id: string,
  body: {
    assetId?: string;
    imageUrl?: string;
    dataBase64?: string;
    mime?: string;
    kind?: "logo" | "image";
  },
) {
  const { data } = await api.post(
    `/api/sales/quotes/${id}/document-asset`,
    body,
    { timeout: 60_000 },
  );
  return data as { ok: true; id: string } | { ok: false; error: string };
}

export async function updateQuote(
  id: string,
  body: {
    notes?: string | null;
    customerName?: string | null;
    companyName?: string | null;
    vendorName?: string | null;
    discountPct?: number | null;
    lines?: Array<{
      productId?: string | null;
      name: string;
      quantity: number;
      unitPrice: number;
    }>;
    documentSections?: QuoteDocumentSection[];
  },
) {
  const { data } = await api.patch(`/api/sales/quotes/${id}`, body);
  return data as { ok: true; id: string } | { ok: false; error: string };
}

export async function deleteQuote(id: string) {
  const { data } = await api.delete(`/api/sales/quotes/${id}`);
  return data as { ok: true; id: string } | { ok: false; error: string };
}

export async function fetchQuoteTemplates() {
  const { data } = await api.get<
    { ok: true; items: QuoteTemplate[] } | { ok: false; error: string }
  >("/api/sales/quote-templates");
  return data;
}

export async function updateQuoteTemplate(
  id: string,
  body: {
    name?: string;
    isDefault?: boolean;
    sections?: QuoteDocumentSection[];
    blueprint?: QuoteTemplate["blueprint"];
    assets?: QuoteTemplate["assets"];
  },
) {
  const { data } = await api.patch(`/api/sales/quote-templates/${id}`, body);
  return data as
    | { ok: true; id: string; template: QuoteTemplate }
    | { ok: false; error: string };
}

export async function uploadQuoteTemplateLogo(
  id: string,
  body: { dataBase64: string; mime: string },
) {
  const { data } = await api.post(`/api/sales/quote-templates/${id}/logo`, body);
  return data as
    | { ok: true; id: string; template: QuoteTemplate }
    | { ok: false; error: string };
}

export async function createQuoteTemplate(body: {
  name: string;
  makeActive?: boolean;
  sections?: QuoteDocumentSection[];
  blueprint?: QuoteTemplate["blueprint"];
  assets?: QuoteTemplate["assets"];
}) {
  const { data } = await api.post("/api/sales/quote-templates", body);
  return data as
    | { ok: true; id: string; template: QuoteTemplate }
    | { ok: false; error: string };
}

export async function deleteQuoteTemplate(id: string) {
  const { data } = await api.delete(`/api/sales/quote-templates/${id}`);
  return data as { ok: true; id: string } | { ok: false; error: string };
}

export async function generateQuoteTemplate(body: {
  brief?: string;
  sampleText?: string;
  sampleFileBase64?: string;
  sampleFilename?: string;
  organizationName?: string;
  existingSections?: QuoteDocumentSection[];
}) {
  const { data } = await api.post("/api/sales/quote-templates/generate", body);
  return data as
    | {
        ok: true;
        kind: "quote";
        sections: QuoteDocumentSection[];
        blueprint?: QuoteTemplate["blueprint"];
        assets?: QuoteTemplate["assets"];
        warnings?: string[];
      }
    | { ok: false; error: string };
}

export async function chatQuoteTemplate(body: {
  message: string;
  currentStep: "idle" | "awaiting_name" | "awaiting_description" | "done";
  turnHint: string;
  createName?: string;
  templateNames?: string[];
  hasSample?: boolean;
  skipEdit?: boolean;
  templateContext?: {
    templateId?: string;
    templateName?: string;
    blueprint?: QuoteTemplate["blueprint"];
    assets?: QuoteTemplate["assets"];
    sections?: Array<{
      id: string;
      key?: string;
      title: string;
      body: string;
      sortOrder?: number;
    }>;
  };
}) {
  const { data } = await api.post("/api/sales/quote-templates/chat", body);
  return data as
    | {
        ok: true;
        text: string;
        fromAgent?: boolean;
        edits?: {
          sections?: Array<{
            id: string;
            key?: string;
            title: string;
            body: string;
            sortOrder?: number;
          }>;
          blueprint?: QuoteTemplate["blueprint"];
          assets?: QuoteTemplate["assets"];
          rename?: string;
          makeActive?: boolean;
          applied?: string[];
        };
      }
    | { ok: false; error: string };
}

export async function sendQuote(id: string) {
  const { data } = await api.post(`/api/sales/quotes/${id}/send`);
  return data as
    | { ok: true; id: string; warning?: string }
    | { ok: false; error: string };
}

export async function resendQuote(id: string) {
  const { data } = await api.post(`/api/sales/quotes/${id}/resend`);
  return data as { ok: true; id: string } | { ok: false; error: string };
}

export async function acceptQuote(id: string) {
  const { data } = await api.post(`/api/sales/quotes/${id}/accept`);
  return data as
    | { ok: true; id: string; invoiceId?: string | null }
    | { ok: false; error: string };
}

export async function rejectQuote(id: string) {
  const { data } = await api.post(`/api/sales/quotes/${id}/reject`);
  return data as { ok: true; id: string } | { ok: false; error: string };
}

/** Finance/admin sign-off on a quote whose discount exceeds a product's cap. */
export async function approveQuoteDiscount(id: string) {
  const { data } = await api.post(`/api/sales/quotes/${id}/approve`);
  return data as { ok: true; id: string } | { ok: false; error: string };
}

/** Finance rejects an over-cap discount; reason is required. */
export async function rejectQuoteDiscount(id: string, reason: string) {
  const { data } = await api.post(`/api/sales/quotes/${id}/reject-discount`, {
    reason,
  });
  return data as { ok: true; id: string } | { ok: false; error: string };
}
