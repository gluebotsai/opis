/**
 * Tenant-agnostic invoice document sections.
 * Merge tokens:
 * {{customerName}} {{companyName}} {{invoiceNumber}} {{date}} {{dueDate}}
 * {{vendorName}} {{currency}} {{subtotal}} {{taxAmount}} {{total}} {{paymentTerms}}
 * {{billingAddress}} {{taxId}}
 */

export type InvoiceDocumentSection = {
  id: string;
  key: string;
  title: string;
  body: string;
  sortOrder: number;
};

export type InvoiceMergeContext = {
  customerName: string;
  companyName: string;
  invoiceNumber: string;
  date: string;
  dueDate: string;
  vendorName: string;
  sellerAddress: string;
  currency: string;
  subtotal: string;
  taxAmount: string;
  total: string;
  paymentTerms: string;
  billingAddress: string;
  taxId: string;
};

export function defaultStandardInvoiceSections(): InvoiceDocumentSection[] {
  return [
    {
      id: "sec-intro",
      key: "introduction",
      title: "Introduction",
      body: `Dear {{customerName}},

Please find invoice {{invoiceNumber}} issued by {{vendorName}} for {{companyName}}.

Issue date: {{date}}
Due date: {{dueDate}}
Payment terms: {{paymentTerms}}`,
      sortOrder: 1,
    },
    {
      id: "sec-line-items",
      key: "line_items",
      title: "Line items",
      body: `Line items appear here when the invoice is generated.`,
      sortOrder: 2,
    },
    {
      id: "sec-tax",
      key: "tax",
      title: "Tax",
      body: `Tax amount: {{currency}} {{taxAmount}}
Tax ID: {{taxId}}

Replace with your standard GST / VAT / sales tax language for {{vendorName}}.`,
      sortOrder: 3,
    },
    {
      id: "sec-payment",
      key: "payment",
      title: "Payment",
      body: `Please remit {{currency}} {{total}} by {{dueDate}}.

Billing address:
{{billingAddress}}

Payment terms: {{paymentTerms}}`,
      sortOrder: 4,
    },
    {
      id: "sec-footer",
      key: "footer",
      title: "Footer",
      body: `This is a computer-generated invoice from {{vendorName}} and does not require a signature.`,
      sortOrder: 5,
    },
  ];
}

export function applyInvoiceDocumentMerge(
  sections: InvoiceDocumentSection[],
  ctx: InvoiceMergeContext,
): InvoiceDocumentSection[] {
  const replace = (text: string) =>
    text
      .replaceAll("{{customerName}}", ctx.customerName)
      .replaceAll("{{companyName}}", ctx.companyName)
      .replaceAll("{{invoiceNumber}}", ctx.invoiceNumber)
      .replaceAll("{{date}}", ctx.date)
      .replaceAll("{{dueDate}}", ctx.dueDate)
      .replaceAll("{{vendorName}}", ctx.vendorName)
      .replaceAll("{{sellerAddress}}", ctx.sellerAddress)
      .replaceAll("{{currency}}", ctx.currency)
      .replaceAll("{{subtotal}}", ctx.subtotal)
      .replaceAll("{{taxAmount}}", ctx.taxAmount)
      .replaceAll("{{total}}", ctx.total)
      .replaceAll("{{paymentTerms}}", ctx.paymentTerms)
      .replaceAll("{{billingAddress}}", ctx.billingAddress)
      .replaceAll("{{taxId}}", ctx.taxId);

  return sections.map((s) => ({
    ...s,
    title: replace(s.title),
    body: replace(s.body),
  }));
}

export function parseInvoiceDocumentSections(
  raw: unknown,
): InvoiceDocumentSection[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((item, idx) => {
      if (!item || typeof item !== "object") return null;
      const o = item as Record<string, unknown>;
      const title = typeof o.title === "string" ? o.title.trim() : "";
      const body = typeof o.body === "string" ? o.body : "";
      if (!title && !body) return null;
      return {
        id:
          typeof o.id === "string" && o.id.trim()
            ? o.id
            : `sec-${idx + 1}`,
        key:
          typeof o.key === "string" && o.key.trim()
            ? o.key
            : `section_${idx + 1}`,
        title: title || `Section ${idx + 1}`,
        body,
        sortOrder:
          typeof o.sortOrder === "number" && Number.isFinite(o.sortOrder)
            ? o.sortOrder
            : idx + 1,
      } satisfies InvoiceDocumentSection;
    })
    .filter((s): s is InvoiceDocumentSection => s != null)
    .sort((a, b) => a.sortOrder - b.sortOrder);
}
