/** Standard commercial payment terms for invoice create / draft. */
export const STANDARD_PAYMENT_TERMS = [
  "Due on receipt",
  "Net 7",
  "Net 15",
  "Net 30",
  "Net 45",
  "Net 60",
  "Net 90",
] as const;

/** Stored value → short label shown in the picker. */
export const PAYMENT_TERMS_OPTIONS: { value: string; label: string }[] = [
  { value: "Due on receipt", label: "Due on receipt — pay immediately" },
  { value: "Net 7", label: "Net 7 — pay within 7 days" },
  { value: "Net 15", label: "Net 15 — pay within 15 days" },
  { value: "Net 30", label: "Net 30 — pay within 30 days" },
  { value: "Net 45", label: "Net 45 — pay within 45 days" },
  { value: "Net 60", label: "Net 60 — pay within 60 days" },
  { value: "Net 90", label: "Net 90 — pay within 90 days" },
];

export function isStandardPaymentTerms(value: string): boolean {
  const trimmed = value.trim();
  return (STANDARD_PAYMENT_TERMS as readonly string[]).includes(trimmed);
}

/** Map any stored value onto a standard option (defaults to Net 30). */
export function normalizePaymentTerms(stored: string): string {
  const trimmed = stored.trim();
  if (isStandardPaymentTerms(trimmed)) return trimmed;
  return "Net 30";
}
