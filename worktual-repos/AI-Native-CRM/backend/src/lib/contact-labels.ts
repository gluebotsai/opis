export const CONTACT_TYPE_OPTIONS = [
  { value: "contact", label: "Contact" },
  { value: "lead", label: "Lead" },
  { value: "prospect", label: "Prospect" },
  { value: "customer", label: "Customer" },
  { value: "churned", label: "Churned" },
] as const;

export const STATUS_OPTIONS = [
  { value: "active", label: "Active" },
  { value: "inactive", label: "Inactive" },
  { value: "archived", label: "Archived" },
] as const;

export const LEAD_STATUS_OPTIONS = [
  { value: "new", label: "New" },
  { value: "contacted", label: "Contacted" },
  { value: "qualifying", label: "Qualifying" },
  { value: "qualified", label: "Qualified" },
  { value: "disqualified", label: "Disqualified" },
  { value: "converted", label: "Converted" },
] as const;

export function formatContactType(value: string | null | undefined) {
  if (!value) return "—";
  return value.charAt(0).toUpperCase() + value.slice(1);
}

export function formatStatus(value: string | null | undefined) {
  if (!value) return "—";
  return value.charAt(0).toUpperCase() + value.slice(1);
}

export function formatLeadStatus(value: string | null | undefined) {
  if (!value) return "—";
  return LEAD_STATUS_OPTIONS.find((o) => o.value === value)?.label ?? value;
}

/** Pill tone classes for lead status tags. */
export function leadStatusTone(value: string | null | undefined): string {
  switch (value) {
    case "new":
      return "bg-blue-50 text-blue-700";
    case "contacted":
      return "bg-violet-0 text-brand";
    case "qualifying":
      return "bg-amber-50 text-amber-800";
    case "qualified":
      return "bg-emerald-50 text-emerald-700";
    case "disqualified":
      return "bg-red-50 text-red-700";
    case "converted":
      return "bg-teal-50 text-teal-800";
    default:
      return "bg-subtle text-text-secondary";
  }
}
