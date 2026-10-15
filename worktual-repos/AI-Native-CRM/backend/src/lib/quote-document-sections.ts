/**
 * Tenant-agnostic quotation document sections (standard template + customer quotes).
 * Merge tokens:
 * {{customerName}} {{companyName}} {{dealTitle}} {{date}} {{vendorName}}
 * {{quoteNumber}} {{currency}} {{subtotal}} {{discountPct}} {{total}} {{validUntil}}
 */

import {
  resolveDocumentSection,
  QUOTE_SECTION_ALIASES,
  DOCUMENT_SECTION_ALIASES,
  type DocumentSectionLike,
} from "./document-section-resolve";

export type QuoteDocumentSection = {
  id: string;
  key: string;
  title: string;
  body: string;
  sortOrder: number;
};

export type QuoteMergeContext = {
  customerName: string;
  companyName: string;
  dealTitle: string;
  date: string;
  vendorName: string;
  quoteNumber: string;
  currency: string;
  subtotal: string;
  discountPct: string;
  total: string;
  validUntil: string;
};

/** Generic commercial quotation skeleton — not vendor-specific. */
export function defaultStandardQuoteSections(): QuoteDocumentSection[] {
  return [
    {
      id: "sec-intro",
      key: "introduction",
      title: "Introduction",
      body: `Dear {{customerName}},

Please find below our quotation {{quoteNumber}} for {{dealTitle}} on behalf of {{companyName}}.

This quotation is issued by {{vendorName}} and is valid until {{validUntil}}.`,
      sortOrder: 1,
    },
    {
      id: "sec-tax-note",
      key: "tax_note",
      title: "Taxes",
      body: `Prices are exclusive of applicable taxes unless stated otherwise. Replace this section with your standard tax language (e.g. GST / VAT / sales tax) for {{vendorName}}.`,
      sortOrder: 2,
    },
    {
      id: "sec-bank",
      key: "bank",
      title: "Bank details",
      body: `Account name: [Your legal entity name]
Bank: [Bank name]
Account number: [Account number]
IFSC / routing / IBAN: [Code]
Branch: [Branch]

Replace these placeholders with {{vendorName}} payment details used for all customers.`,
      sortOrder: 3,
    },
    {
      id: "sec-terms",
      key: "terms",
      title: "Terms & conditions",
      body: `1. Prices are subject to applicable taxes as mentioned above.
2. This quotation is valid until {{validUntil}}.
3. Scope is limited to the line items listed; changes may attract additional charges.
4. Payment terms and delivery timelines below apply unless otherwise agreed in writing.`,
      sortOrder: 4,
    },
    {
      id: "sec-payment",
      key: "payment_terms",
      title: "Payment terms",
      body: `Due within [e.g. 7 / 15 / 30] days of acceptance, or as agreed on the purchase order.`,
      sortOrder: 5,
    },
    {
      id: "sec-delivery",
      key: "delivery",
      title: "Delivery timeline",
      body: `Delivery / service start window will be confirmed after acceptance. Typical window: [start date] to [end date].`,
      sortOrder: 6,
    },
    {
      id: "sec-footer",
      key: "footer",
      title: "Footer",
      body: `This is a computer-generated quotation from {{vendorName}} and does not require a signature.`,
      sortOrder: 7,
    },
  ];
}

export function applyQuoteDocumentMerge(
  sections: QuoteDocumentSection[],
  ctx: QuoteMergeContext,
): QuoteDocumentSection[] {
  const replace = (text: string) =>
    text
      .replaceAll("{{customerName}}", ctx.customerName)
      .replaceAll("{{companyName}}", ctx.companyName)
      .replaceAll("{{dealTitle}}", ctx.dealTitle)
      .replaceAll("{{date}}", ctx.date)
      .replaceAll("{{vendorName}}", ctx.vendorName)
      .replaceAll("{{quoteNumber}}", ctx.quoteNumber)
      .replaceAll("{{currency}}", ctx.currency)
      .replaceAll("{{subtotal}}", ctx.subtotal)
      .replaceAll("{{discountPct}}", ctx.discountPct)
      .replaceAll("{{total}}", ctx.total)
      .replaceAll("{{validUntil}}", ctx.validUntil);

  return sections.map((s) => ({
    ...s,
    title: replace(s.title),
    body: replace(s.body),
  }));
}

export function parseQuoteDocumentSections(raw: unknown): QuoteDocumentSection[] {
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
      } satisfies QuoteDocumentSection;
    })
    .filter((s): s is QuoteDocumentSection => s != null)
    .sort((a, b) => a.sortOrder - b.sortOrder);
}

/** Simple English amount-in-words for printable quotes (any currency label). */
export function amountInWords(amount: number, currencyLabel: string): string {
  const n = Math.round(Math.abs(amount) * 100) / 100;
  const whole = Math.floor(n);
  const cents = Math.round((n - whole) * 100);
  const words = integerToWords(whole);
  const fraction =
    cents > 0 ? ` and ${integerToWords(cents)}/100` : "";
  return `${words}${fraction} ${currencyLabel}`.replace(/\s+/g, " ").trim();
}

function integerToWords(n: number): string {
  if (n === 0) return "Zero";
  const ones = [
    "",
    "One",
    "Two",
    "Three",
    "Four",
    "Five",
    "Six",
    "Seven",
    "Eight",
    "Nine",
    "Ten",
    "Eleven",
    "Twelve",
    "Thirteen",
    "Fourteen",
    "Fifteen",
    "Sixteen",
    "Seventeen",
    "Eighteen",
    "Nineteen",
  ];
  const tens = [
    "",
    "",
    "Twenty",
    "Thirty",
    "Forty",
    "Fifty",
    "Sixty",
    "Seventy",
    "Eighty",
    "Ninety",
  ];

  const chunk = (num: number): string => {
    if (num < 20) return ones[num];
    if (num < 100) {
      const t = Math.floor(num / 10);
      const o = num % 10;
      return `${tens[t]}${o ? ` ${ones[o]}` : ""}`.trim();
    }
    const h = Math.floor(num / 100);
    const rest = num % 100;
    return `${ones[h]} Hundred${rest ? ` ${chunk(rest)}` : ""}`.trim();
  };

  const scales = [
    { v: 1_000_000_000, n: "Billion" },
    { v: 1_000_000, n: "Million" },
    { v: 1_000, n: "Thousand" },
  ];

  let remaining = n;
  const parts: string[] = [];
  for (const s of scales) {
    if (remaining >= s.v) {
      const q = Math.floor(remaining / s.v);
      parts.push(`${chunk(q)} ${s.n}`);
      remaining %= s.v;
    }
  }
  if (remaining > 0) parts.push(chunk(remaining));
  return parts.join(" ");
}

export function resolveQuoteDocumentSection(
  sections: QuoteDocumentSection[],
  sectionKey: string,
): QuoteDocumentSection | null {
  const found = resolveDocumentSection(
    sections as DocumentSectionLike[],
    sectionKey,
    { ...DOCUMENT_SECTION_ALIASES, ...QUOTE_SECTION_ALIASES },
  );
  return found as QuoteDocumentSection | null;
}
