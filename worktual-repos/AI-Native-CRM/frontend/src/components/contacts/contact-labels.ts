import {
  CHIP_BASE,
  TONE_ACCENT,
  TONE_DANGER,
  TONE_INFO,
  TONE_MUTED,
  TONE_SUCCESS,
  TONE_WARNING,
} from "@/lib/ui-tones";

export const CONTACT_TYPE_OPTIONS = [
  { value: "all", label: "All stages" },
  { value: "contact", label: "Contact" },
  { value: "lead", label: "Lead" },
  { value: "prospect", label: "Prospect" },
  { value: "customer", label: "Customer" },
  { value: "churned", label: "Churned" },
] as const;

export const STATUS_OPTIONS = [
  { value: "all", label: "All contacts" },
  { value: "active", label: "Active" },
  { value: "inactive", label: "Inactive" },
  { value: "unknown", label: "Unknown" },
] as const;

export const LEAD_STATUS_OPTIONS = [
  { value: "all", label: "All lead statuses" },
  { value: "new", label: "New" },
  { value: "contacted", label: "Contacted" },
  { value: "qualifying", label: "Qualifying" },
  { value: "qualified", label: "Qualified" },
  { value: "disqualified", label: "Disqualified" },
  { value: "converted", label: "Converted" },
] as const;

export const CONTACT_TYPE_FORM_OPTIONS = CONTACT_TYPE_OPTIONS.filter(
  (o) => o.value !== "all",
);
/** Form status values (CRM field) — separate from list reachability filter. */
export const STATUS_FORM_OPTIONS = [
  { value: "active", label: "Active" },
  { value: "inactive", label: "Inactive" },
  { value: "archived", label: "Archived" },
] as const;
export const LEAD_STATUS_FORM_OPTIONS = LEAD_STATUS_OPTIONS.filter(
  (o) => o.value !== "all",
);

export function formatContactType(value: string | null | undefined) {
  const v = (value ?? "contact").trim().toLowerCase();
  return (
    CONTACT_TYPE_OPTIONS.find((o) => o.value === v)?.label ??
    (v ? v.charAt(0).toUpperCase() + v.slice(1) : "Contact")
  );
}

export function formatStatus(value: string | null | undefined) {
  if (!value) return "—";
  return value.charAt(0).toUpperCase() + value.slice(1);
}

export function formatLeadStatus(value: string | null | undefined) {
  if (!value) return "—";
  return (
    LEAD_STATUS_FORM_OPTIONS.find((o) => o.value === value)?.label ??
    LEAD_STATUS_OPTIONS.find((o) => o.value === value)?.label ??
    value
  );
}

/** Pill tone classes for lead status tags — brand semantic palette. */
export function leadStatusTone(value: string | null | undefined): string {
  switch (value) {
    case "new":
      return `${CHIP_BASE} ${TONE_INFO}`;
    case "contacted":
      return `${CHIP_BASE} ${TONE_ACCENT}`;
    case "qualifying":
      return `${CHIP_BASE} ${TONE_WARNING}`;
    case "qualified":
      return `${CHIP_BASE} ${TONE_SUCCESS}`;
    case "disqualified":
      return `${CHIP_BASE} ${TONE_DANGER}`;
    case "converted":
      return `${CHIP_BASE} ${TONE_SUCCESS}`;
    default:
      return `${CHIP_BASE} ${TONE_MUTED}`;
  }
}
