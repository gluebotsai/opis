/**
 * Build GFM pipe tables for quote/invoice line items so
 * formatSectionBodyHtml → bp-table with black borders.
 */

export type CommercialLineRow = {
  name: string;
  description?: string | null;
  quantity: number | string;
  unitPrice: number | string;
  amount: number | string;
  taxPercent?: number | string | null;
};

function cell(value: string | number | null | undefined): string {
  return String(value ?? "")
    .replace(/\|/g, "/")
    .replace(/\n+/g, " ")
    .trim();
}

function money(value: number | string, currency?: string): string {
  const n =
    typeof value === "number" ? value : Number.parseFloat(String(value));
  const formatted = Number.isFinite(n)
    ? n.toLocaleString(undefined, {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      })
    : cell(value);
  return currency ? `${currency} ${formatted}` : formatted;
}

function lineAmountInclTax(
  amount: number | string,
  taxPercent: number | string | null | undefined,
): number {
  const base = Number(amount) || 0;
  const pct = Number(taxPercent) || 0;
  return base * (1 + pct / 100);
}

/** Markdown pipe table: Item | Qty | Unit price | Amount (ex-tax, quotes). */
export function commercialLinesPipeTable(
  lines: CommercialLineRow[],
  currency?: string,
): string {
  if (!lines.length) {
    return "_No line items._";
  }
  const header =
    "| Item | Qty | Unit price | Amount |\n| --- | --- | --- | --- |";
  const rows = lines.map((line) => {
    const label = line.description?.trim()
      ? `${cell(line.name)} — ${cell(line.description)}`
      : cell(line.name);
    return `| ${label} | ${cell(line.quantity)} | ${money(line.unitPrice, currency)} | ${money(line.amount, currency)} |`;
  });
  return [header, ...rows].join("\n");
}

/**
 * Invoice table matching commercial / WIPL sample PDFs:
 * Solution | Description | Qty | Unit Price | Subtotal
 */
export function commercialInvoiceLinesPipeTable(
  lines: CommercialLineRow[],
  currency?: string,
): string {
  if (!lines.length) {
    return "_No line items._";
  }
  const header =
    "| Solution | Description | Qty | Unit Price | Subtotal |\n| --- | --- | --- | --- | --- |";
  const rows = lines.map((line) => {
    const solution = cell(line.name);
    const description = cell(line.description?.trim() || "—");
    return `| **${solution}** | ${description} | ${cell(line.quantity)} | ${money(line.unitPrice, currency)} | **${money(line.amount, currency)}** |`;
  });
  return [header, ...rows].join("\n");
}

/**
 * Invoice table matching the native CRM layout:
 * Item | Qty | Unit | Tax % | Amount (incl. tax)
 */
export function invoiceLinesPipeTable(
  lines: CommercialLineRow[],
  currency?: string,
): string {
  if (!lines.length) {
    return "_No line items._";
  }
  const header =
    "| Item | Qty | Unit | Tax % | Amount (incl. tax) |\n| --- | --- | --- | --- | --- |";
  const rows = lines.map((line) => {
    const label = line.description?.trim()
      ? `${cell(line.name)} — ${cell(line.description)}`
      : cell(line.name);
    const pct = Number(line.taxPercent) || 0;
    const incl = lineAmountInclTax(line.amount, line.taxPercent);
    return `| ${label} | ${cell(line.quantity)} | ${money(line.unitPrice, currency)} | ${cell(pct)} | ${money(incl, currency)} |`;
  });
  return [header, ...rows].join("\n");
}

/** Financial summary block for commercial invoice templates. */
export function commercialFinancialSummaryMarkdown(input: {
  currency: string;
  subtotal: number | string;
  taxAmount?: number | string | null;
  taxDetails?: {
    components?: Array<{
      label: string;
      percent: number;
      amount: number;
    }> | null;
    summaryLines?: string[] | null;
    system?: string | null;
    effectivePercent?: number | null;
  } | null;
  total: number | string;
}): string {
  const lines: string[] = [];
  lines.push(`Subtotal: ${money(input.subtotal, input.currency)}`);
  const components = input.taxDetails?.components ?? [];
  if (components.length) {
    for (const c of components) {
      lines.push(
        `${cell(c.label)} (${c.percent}%): ${money(c.amount, input.currency)}`,
      );
    }
  } else if (input.taxAmount != null && Number(input.taxAmount) !== 0) {
    const pct = input.taxDetails?.effectivePercent;
    const system = input.taxDetails?.system || "Tax";
    const label =
      pct != null ? `@ ${pct}% ${system}` : system;
    lines.push(`${label}: ${money(input.taxAmount, input.currency)}`);
  }
  if (input.taxDetails?.summaryLines?.length) {
    for (const line of input.taxDetails.summaryLines) {
      lines.push(`_${cell(line)}_`);
    }
  }
  lines.push(`**Total Amount: ${money(input.total, input.currency)}**`);
  return lines.join("\n");
}

/** Totals block as plain text (after the line table). */
export function commercialTotalsMarkdown(input: {
  currency: string;
  subtotal?: number | string | null;
  discountLabel?: string | null;
  discountAmount?: number | string | null;
  taxLabel?: string | null;
  taxAmount?: number | string | null;
  total: number | string;
}): string {
  const lines: string[] = [];
  if (input.subtotal != null && String(input.subtotal) !== "") {
    lines.push(`Subtotal: ${money(input.subtotal, input.currency)}`);
  }
  if (
    input.discountAmount != null &&
    Number(input.discountAmount) !== 0
  ) {
    lines.push(
      `Discount${input.discountLabel ? ` (${input.discountLabel})` : ""}: ${money(input.discountAmount, input.currency)}`,
    );
  }
  if (input.taxAmount != null && Number(input.taxAmount) !== 0) {
    lines.push(
      `Tax${input.taxLabel ? ` (${input.taxLabel})` : ""}: ${money(input.taxAmount, input.currency)}`,
    );
  }
  lines.push(`**Total: ${money(input.total, input.currency)}**`);
  return lines.join("\n");
}

/** Invoice totals with CGST/SGST components when available. */
export function invoiceTotalsMarkdown(input: {
  currency: string;
  subtotal: number | string;
  discountAmount?: number | string | null;
  taxAmount?: number | string | null;
  taxDetails?: {
    components?: Array<{
      label: string;
      percent: number;
      amount: number;
    }> | null;
    summaryLines?: string[] | null;
    system?: string | null;
    effectivePercent?: number | null;
  } | null;
  total: number | string;
}): string {
  const lines: string[] = [];
  lines.push(
    `Subtotal (excl. tax): ${money(input.subtotal, input.currency)}`,
  );
  if (
    input.discountAmount != null &&
    Number(input.discountAmount) !== 0
  ) {
    lines.push(
      `Discount: −${money(input.discountAmount, input.currency)}`,
    );
  }
  const components = input.taxDetails?.components ?? [];
  if (components.length) {
    for (const c of components) {
      lines.push(
        `${cell(c.label)} (${c.percent}%): ${money(c.amount, input.currency)}`,
      );
    }
  } else if (input.taxAmount != null && Number(input.taxAmount) !== 0) {
    const taxLabel =
      input.taxDetails?.system && input.taxDetails.effectivePercent != null
        ? `Tax · ${input.taxDetails.system} (${input.taxDetails.effectivePercent}%)`
        : "Tax";
    lines.push(`${taxLabel}: ${money(input.taxAmount, input.currency)}`);
  }
  const summaries = (input.taxDetails?.summaryLines ?? []).filter(Boolean);
  if (summaries.length) {
    lines.push("");
    for (const s of summaries) {
      lines.push(`_${cell(s)}_`);
    }
  }
  lines.push("");
  lines.push(`**Amount due: ${money(input.total, input.currency)}**`);
  return lines.join("\n");
}

/** Drop sample tax/totals sections — live totals live under line_items. */
export function stripRedundantInvoiceTotalSections<
  T extends { key: string; title: string },
>(sections: T[]): T[] {
  return sections.filter((s) => {
    const key = (s.key || "").toLowerCase().trim();
    const title = (s.title || "").toLowerCase().trim();
    if (
      key === "tax" ||
      key === "tax_summary" ||
      key === "totals" ||
      key === "summary"
    ) {
      return false;
    }
    if (/^(tax(\s*summary)?|totals?|amount\s+due)$/.test(title)) {
      return false;
    }
    return true;
  });
}

/**
 * Ensure sections include a line_items section with the pipe table + totals.
 * Inserts after introduction when missing; replaces body when key exists.
 */
export function withCommercialLineItemsSection<
  T extends { id: string; key: string; title: string; body: string; sortOrder: number },
>(
  sections: T[],
  linesMarkdown: string,
  totalsMarkdown: string,
  opts?: { stripInvoiceTotals?: boolean },
): T[] {
  const base = opts?.stripInvoiceTotals
    ? stripRedundantInvoiceTotalSections(sections)
    : sections;
  const body = `${linesMarkdown}\n\n${totalsMarkdown}`.trim();
  const existing = base.findIndex(
    (s) => (s.key || "").toLowerCase() === "line_items",
  );
  if (existing >= 0) {
    return base.map((s, i) =>
      i === existing ? { ...s, title: s.title || "Line items", body } : s,
    );
  }
  const introIdx = base.findIndex(
    (s) => (s.key || "").toLowerCase() === "introduction",
  );
  const insertAt = introIdx >= 0 ? introIdx + 1 : 0;
  const sortBase =
    insertAt > 0
      ? base[insertAt - 1]!.sortOrder + 0.5
      : (base[0]?.sortOrder ?? 1) - 0.5;
  const lineSection = {
    id: "sec-line-items",
    key: "line_items",
    title: "Line items",
    body,
    sortOrder: sortBase,
  } as T;
  const next = base.slice();
  next.splice(insertAt, 0, lineSection);
  return next
    .map((s, i) => ({ ...s, sortOrder: i + 1 }))
    .sort((a, b) => a.sortOrder - b.sortOrder);
}
