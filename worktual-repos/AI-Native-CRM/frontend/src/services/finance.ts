import { api } from "./api";

export type InvoiceListItem = {
  id: string;
  number: string;
  status: string;
  displayStatus: string;
  total: string;
  currency: string;
  companyId: string;
  companyName: string;
  orderNumber: string | null;
  dealId: string | null;
  dealTitle: string | null;
  dueAt: string | null;
  paidAt: string | null;
  createdAt: string;
  escalationSeverity: string | null;
  approvalStatus: string | null;
  approvedAt: string | null;
  billingKind?: string | null;
};

export type InvoiceSummary = {
  outstanding: number;
  openCount: number;
  overdueCount: number;
  collected: number;
  currency: string;
};

export type InvoiceBarItem = {
  id: string;
  number: string;
  status: string;
  displayStatus: string;
  total: string;
  currency: string;
};

export type InvoiceDetail = {
  id: string;
  number: string;
  status: string;
  total: string;
  discountAmount: string;
  taxAmount: string;
  currency: string;
  companyId: string;
  companyName: string;
  orderId: string | null;
  orderNumber: string | null;
  dealId: string | null;
  dealTitle: string | null;
  dueAt: string | null;
  paidAt: string | null;
  issueDate: string | null;
  paymentTerms: string | null;
  notes: string | null;
  billingAddress: string | null;
  leadEmail: string | null;
  leadPhone: string | null;
  taxId: string | null;
  taxDetails: {
    country: string;
    system: string;
    effectivePercent: number;
    taxAmount: number;
    components: Array<{
      code: string;
      label: string;
      percent: number;
      amount: number;
    }>;
    summaryLines: string[];
  } | null;
  templateId?: string | null;
  templateName?: string | null;
  vendorName?: string | null;
  sellerAddress?: string | null;
  sellerLetterhead?: string | null;
  vendorLegalName?: string | null;
  amountInWords?: string | null;
  sections?: InvoiceDocumentSection[];
  blueprint?: InvoiceTemplate["blueprint"];
  assets?: InvoiceTemplate["assets"];
  createdAt: string;
  lines: Array<{
    id: string;
    kind: string;
    name: string;
    description: string | null;
    quantity: string;
    unitPrice: string;
    taxPercent: string;
    amount: string;
  }>;
  /** Invoice Escalation Agent — collections-risk overlay (informational only). */
  escalationSeverity?: string | null;
  escalationReason?: string | null;
  escalationDraft?: string | null;
  escalationLastRunAt?: string | null;
  approvalStatus?: string | null;
  approvedAt?: string | null;
  approvalNote?: string | null;
  billingKind?: string | null;
  paymentMethod?: string | null;
  paymentReference?: string | null;
  paymentConfirmedAt?: string | null;
  voidedAt?: string | null;
  voidReason?: string | null;
  submittedForApprovalAt?: string | null;
  resubmittedAt?: string | null;
  paymentProvider?: string | null;
  paymentLinkUrl?: string | null;
  paymentSessionStatus?: string | null;
  paymentSessionExpiresAt?: string | null;
  sentAt?: string | null;
  lastSentAt?: string | null;
  paymentPathMode?: "online" | "offline" | "blocked" | null;
  paymentPathReason?: string | null;
  allowedPaymentProviders?: Array<"stripe" | "razorpay">;
  contractId?: string | null;
  billingScheduleId?: string | null;
};

export type InvoiceDocumentSection = {
  id: string;
  key: string;
  title: string;
  body: string;
  sortOrder: number;
};

export type InvoiceTemplate = {
  id: string;
  name: string;
  code: string | null;
  kind: string;
  isDefault: boolean;
  sections: InvoiceDocumentSection[];
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

export type DealInvoiceOption = {
  id: string;
  title: string;
  companyName: string;
  stage: string;
  amount: string | null;
};

export type DealInvoiceAutofill = {
  dealId: string;
  dealTitle: string;
  companyId: string;
  companyName: string;
  billingAddress: string;
  leadEmail: string;
  leadPhone: string;
  contactName: string | null;
  currency: string;
  suggestedTotal: string | null;
  paymentTerms: string;
  issueDate: string;
  dueDate: string;
  existingInvoiceId: string | null;
  existingInvoiceNumber: string | null;
  tax: {
    country: "IN" | "UK" | "US";
    taxId: string;
    indiaGstRate: 0 | 5 | 12 | 18 | 28;
    sellerState: string;
    buyerState: string;
    ukVatCategory:
      | "standard"
      | "reduced"
      | "zero"
      | "exempt"
      | "outside_scope";
    usStatePercent: number;
    usCountyPercent: number;
    usCityPercent: number;
    usDistrictPercent: number;
    sourceNotes: string[];
  };
};

export type InvoiceTaxConfigInput =
  | {
      country: "IN";
      gstRate: 0 | 5 | 12 | 18 | 28;
      sellerState: string;
      buyerState: string;
    }
  | {
      country: "UK";
      vatCategory: "standard" | "reduced" | "zero" | "exempt" | "outside_scope";
    }
  | {
      country: "US";
      statePercent?: number;
      countyPercent?: number;
      cityPercent?: number;
      specialDistrictPercent?: number;
    };

export type InvoiceProductOption = {
  id: string;
  name: string;
  sku: string | null;
  price: string | null;
  currency: string;
  productType: string;
  addons: Array<{
    id: string;
    name: string;
    unitLabel: string | null;
    pricingModel: "flat" | "per_unit" | "stepped" | "tiered";
    flatPrice: string | null;
    unitPrice: string | null;
    stepSize: number | null;
    stepPrice: string | null;
    tiers: Array<{
      minQty: number;
      maxQty: number | null;
      unitPrice: string;
    }>;
  }>;
};

export async function fetchInvoicesPage(params: {
  page?: number;
  search?: string;
  status?: string;
}) {
  const { data } = await api.get<{
    ok: true;
    items: InvoiceListItem[];
    pagination: {
      page: number;
      pageSize: number;
      total: number;
      totalPages: number;
      hasNext: boolean;
    };
    summary: InvoiceSummary;
  }>("/api/finance/invoices", { params });
  return data;
}

export async function fetchInvoiceBar() {
  const { data } = await api.get<{ ok: true; items: InvoiceBarItem[] }>(
    "/api/finance/invoices/bar",
  );
  return data;
}

export async function fetchInvoice(id: string) {
  const { data } = await api.get<
    { ok: true; invoice: InvoiceDetail } | { ok: false; error: string }
  >(`/api/finance/invoices/${id}`);
  return data;
}

export async function downloadInvoiceCsv(id: string) {
  const response = await api.get(`/api/finance/invoices/${id}/csv`, {
    responseType: "blob",
  });
  return response.data as Blob;
}

export async function downloadInvoicePdf(id: string) {
  const response = await api.get(`/api/finance/invoices/${id}/pdf`, {
    responseType: "blob",
  });
  return response.data as Blob;
}

export async function downloadInvoiceDocx(id: string) {
  const response = await api.get(`/api/finance/invoices/${id}/docx`, {
    responseType: "blob",
  });
  return response.data as Blob;
}

export async function fetchInvoiceCreateOptions() {
  const { data } = await api.get<{
    ok: true;
    deals: DealInvoiceOption[];
    products: InvoiceProductOption[];
    bar: InvoiceBarItem[];
    templates?: Array<{ id: string; name: string; isDefault: boolean }>;
  }>("/api/finance/invoices/create-options");
  return data;
}

export async function fetchDealInvoiceAutofill(dealId: string) {
  const { data } = await api.get<
    { ok: true; data: DealInvoiceAutofill } | { ok: false; error: string }
  >(`/api/finance/invoices/autofill/${dealId}`);
  return data;
}

export async function createInvoice(body: {
  dealId: string;
  currency?: string;
  status?: "draft" | "sent";
  billingKind?: string;
  paymentTerms?: string | null;
  notes?: string | null;
  billingAddress?: string | null;
  leadEmail?: string | null;
  leadPhone?: string | null;
  taxId?: string | null;
  discountAmount?: number;
  issueDate?: string | null;
  dueAt?: string | null;
  taxConfig?: InvoiceTaxConfigInput;
  templateId?: string | null;
  lines: Array<{
    kind: "product" | "addon";
    productId?: string | null;
    addonId?: string | null;
    name: string;
    description?: string | null;
    quantity: number;
    unitPrice: number;
    taxPercent?: number;
    amount: number;
  }>;
}) {
  const { data } = await api.post("/api/finance/invoices", body);
  return data as { ok: true; id: string } | { ok: false; error: string };
}

export async function markInvoicePaid(
  id: string,
  body?: { paymentReference?: string; paymentMethod?: "offline" | "manual" },
) {
  const { data } = await api.post(`/api/finance/invoices/${id}/mark-paid`, body ?? {});
  return data as { ok: true; id: string } | { ok: false; error: string };
}

export async function resendInvoice(
  id: string,
  body?: { paymentProvider?: "stripe" | "razorpay" },
) {
  const { data } = await api.post(`/api/finance/invoices/${id}/resend`, body ?? {});
  return data as { ok: true; id: string } | { ok: false; error: string };
}

export async function voidInvoice(id: string, reason: string) {
  const { data } = await api.post(`/api/finance/invoices/${id}/void`, { reason });
  return data as { ok: true; id: string } | { ok: false; error: string };
}

export async function withdrawInvoiceApproval(id: string) {
  const { data } = await api.post(`/api/finance/invoices/${id}/withdraw-approval`);
  return data as { ok: true; id: string } | { ok: false; error: string };
}

export async function resubmitInvoice(id: string) {
  const { data } = await api.post(`/api/finance/invoices/${id}/resubmit`);
  return data as { ok: true; id: string } | { ok: false; error: string };
}

export async function approveInvoice(id: string) {
  const { data } = await api.post(`/api/finance/invoices/${id}/approve`);
  return data as { ok: true; id: string } | { ok: false; error: string };
}

export async function rejectInvoiceApproval(id: string, reason: string) {
  const { data } = await api.post(`/api/finance/invoices/${id}/reject`, {
    reason,
  });
  return data as { ok: true; id: string } | { ok: false; error: string };
}

export function invoiceBlocksCustomerSend(invoice: {
  billingKind?: string | null;
}): boolean {
  const kind = invoice.billingKind ?? "standard";
  return kind === "adjustment" || kind === "credit";
}

export function invoiceIsApproved(invoice: {
  approvedAt?: string | null;
  approvalStatus?: string | null;
}): boolean {
  if (invoice.approvalStatus === "finance_rejected") return false;
  return (
    Boolean(invoice.approvedAt) ||
    invoice.approvalStatus === "approved" ||
    invoice.approvalStatus === "sent"
  );
}

export async function deleteInvoice(id: string) {
  const { data } = await api.delete(`/api/finance/invoices/${id}`);
  return data as { ok: true; id: string } | { ok: false; error: string };
}

export async function updateInvoice(
  id: string,
  body: {
    notes?: string | null;
    paymentTerms?: string | null;
    discountAmount?: number | null;
    discountPct?: number | null;
    lines?: Array<{
      productId?: string | null;
      name: string;
      quantity: number;
      unitPrice: number;
      description?: string | null;
    }>;
  },
) {
  const { data } = await api.patch(`/api/finance/invoices/${id}`, body);
  return data as { ok: true; id: string } | { ok: false; error: string };
}

export async function sendInvoiceEmail(
  id: string,
  body?: { paymentProvider?: "stripe" | "razorpay" },
) {
  const { data } = await api.post(`/api/finance/invoices/${id}/send`, body ?? {});
  return data as { ok: true; id: string } | { ok: false; error: string };
}

export async function fetchInvoiceTemplates() {
  const { data } = await api.get<
    { ok: true; items: InvoiceTemplate[] } | { ok: false; error: string }
  >("/api/finance/invoice-templates");
  return data;
}

export async function updateInvoiceTemplate(
  id: string,
  body: {
    name?: string;
    isDefault?: boolean;
    sections?: InvoiceDocumentSection[];
    blueprint?: InvoiceTemplate["blueprint"];
    assets?: InvoiceTemplate["assets"];
  },
) {
  const { data } = await api.patch(`/api/finance/invoice-templates/${id}`, body);
  return data as
    | { ok: true; id: string; template: InvoiceTemplate }
    | { ok: false; error: string };
}

export async function uploadInvoiceTemplateLogo(
  id: string,
  body: { dataBase64: string; mime: string },
) {
  const { data } = await api.post(`/api/finance/invoice-templates/${id}/logo`, body);
  return data as
    | { ok: true; id: string; template: InvoiceTemplate }
    | { ok: false; error: string };
}

export async function createInvoiceTemplate(body: {
  name: string;
  makeActive?: boolean;
  sections?: InvoiceDocumentSection[];
  blueprint?: InvoiceTemplate["blueprint"];
  assets?: InvoiceTemplate["assets"];
}) {
  const { data } = await api.post("/api/finance/invoice-templates", body);
  return data as
    | { ok: true; id: string; template: InvoiceTemplate }
    | { ok: false; error: string };
}

export async function deleteInvoiceTemplate(id: string) {
  const { data } = await api.delete(`/api/finance/invoice-templates/${id}`);
  return data as { ok: true; id: string } | { ok: false; error: string };
}

export async function generateInvoiceTemplate(body: {
  brief?: string;
  sampleText?: string;
  sampleFileBase64?: string;
  sampleFilename?: string;
  organizationName?: string;
  existingSections?: InvoiceDocumentSection[];
}) {
  const { data } = await api.post(
    "/api/finance/invoice-templates/generate",
    body,
  );
  return data as
    | {
        ok: true;
        kind: "invoice";
        sections: InvoiceDocumentSection[];
        blueprint?: InvoiceTemplate["blueprint"];
        assets?: InvoiceTemplate["assets"];
        warnings?: string[];
      }
    | { ok: false; error: string };
}

export async function chatInvoiceTemplate(body: {
  message: string;
  currentStep: string;
  turnHint?: string;
  createName?: string;
  templateNames?: string[];
  hasSample?: boolean;
  skipEdit?: boolean;
  templateContext?: {
    templateId?: string;
    templateName?: string;
    blueprint?: InvoiceTemplate["blueprint"];
    assets?: InvoiceTemplate["assets"];
    sections?: Array<{
      id: string;
      key?: string;
      title: string;
      body: string;
      sortOrder?: number;
    }>;
  };
}) {
  const { data } = await api.post("/api/finance/invoice-templates/chat", body);
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
          blueprint?: InvoiceTemplate["blueprint"];
          assets?: InvoiceTemplate["assets"];
          rename?: string;
          makeActive?: boolean;
          applied?: string[];
        };
      }
    | { ok: false; error: string };
}
