import type { OrganizationVertical } from "@prisma/client";

export type VerticalFieldType = "string" | "number" | "boolean";

export type VerticalFieldDefinition = {
  key: string;
  label: string;
  type: VerticalFieldType;
  required?: boolean;
  /** Entity the field applies to. */
  entity: "contact" | "company" | "order";
  placeholder?: string;
};

export type VerticalPack = {
  id: OrganizationVertical;
  label: string;
  description: string;
  fields: VerticalFieldDefinition[];
};

/** Code-registered packs — adding an industry = new entry here, not new tables. */
export const VERTICAL_PACKS: Record<OrganizationVertical, VerticalPack> = {
  general: {
    id: "general",
    label: "General",
    description: "Default CRM fields only.",
    fields: [],
  },
  ecommerce: {
    id: "ecommerce",
    label: "Ecommerce",
    description: "Retail / online commerce consumers.",
    fields: [
      {
        key: "loyalty_tier",
        label: "Loyalty tier",
        type: "string",
        entity: "contact",
        placeholder: "Gold",
      },
      {
        key: "preferred_channel",
        label: "Preferred channel",
        type: "string",
        entity: "contact",
        placeholder: "App / Web / Store",
      },
    ],
  },
  healthcare: {
    id: "healthcare",
    label: "Healthcare",
    description: "Clinics, pharmacies, patient-facing B2C.",
    fields: [
      {
        key: "patient_ref",
        label: "Patient reference",
        type: "string",
        entity: "contact",
        placeholder: "MRN / external id",
      },
      {
        key: "consent_marketing",
        label: "Marketing consent",
        type: "boolean",
        entity: "contact",
      },
    ],
  },
  finance: {
    id: "finance",
    label: "Finance",
    description: "Banking, insurance, fintech consumers.",
    fields: [
      {
        key: "kyc_status",
        label: "KYC status",
        type: "string",
        entity: "contact",
        placeholder: "pending / verified",
      },
      {
        key: "risk_band",
        label: "Risk band",
        type: "string",
        entity: "contact",
        placeholder: "A / B / C",
      },
    ],
  },
  telecom: {
    id: "telecom",
    label: "Telecom",
    description: "Mobile / broadband subscribers.",
    fields: [
      {
        key: "msisdn",
        label: "MSISDN",
        type: "string",
        entity: "contact",
        placeholder: "+91…",
      },
      {
        key: "plan_code",
        label: "Plan code",
        type: "string",
        entity: "contact",
      },
    ],
  },
};

export const ORGANIZATION_VERTICALS = Object.keys(
  VERTICAL_PACKS,
) as OrganizationVertical[];

export function getVerticalPack(
  vertical: OrganizationVertical | string | null | undefined,
): VerticalPack {
  const key = (vertical ?? "general") as OrganizationVertical;
  return VERTICAL_PACKS[key] ?? VERTICAL_PACKS.general;
}

export function contactFieldsForVertical(
  vertical: OrganizationVertical | string | null | undefined,
): VerticalFieldDefinition[] {
  return getVerticalPack(vertical).fields.filter((f) => f.entity === "contact");
}

export function parseOrganizationVertical(
  raw: string | null | undefined,
): OrganizationVertical | null {
  const v = raw?.trim().toLowerCase();
  if (
    v === "general" ||
    v === "ecommerce" ||
    v === "healthcare" ||
    v === "finance" ||
    v === "telecom"
  ) {
    return v;
  }
  return null;
}

/**
 * Map `accounts.organizations.industry_type` (free text, set at tenant signup)
 * onto a CRM field pack. Unrecognized / empty → general (core contact fields only).
 */
export function mapIndustryTypeToVertical(
  raw: string | null | undefined,
): OrganizationVertical {
  const exact = parseOrganizationVertical(raw);
  if (exact) return exact;
  const n = (raw ?? "")
    .trim()
    .toLowerCase()
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ");
  if (!n) return "general";
  if (
    n.includes("ecommerce") ||
    n.includes("e commerce") ||
    n.includes("retail") ||
    n.includes("d2c") ||
    n.includes("dtc")
  ) {
    return "ecommerce";
  }
  if (
    n.includes("health") ||
    n.includes("clinic") ||
    n.includes("hospital") ||
    n.includes("pharma") ||
    n.includes("medical")
  ) {
    return "healthcare";
  }
  if (
    n.includes("finance") ||
    n.includes("bank") ||
    n.includes("insur") ||
    n.includes("fintech") ||
    n.includes("nbfc")
  ) {
    return "finance";
  }
  if (
    n.includes("telecom") ||
    n.includes("telco") ||
    n.includes("mobile") ||
    n.includes("broadband") ||
    n === "isp"
  ) {
    return "telecom";
  }
  return "general";
}

/** Keep only known pack keys; coerce booleans/numbers lightly. */
export function sanitizeCustomAttributes(
  vertical: OrganizationVertical | string | null | undefined,
  raw: Record<string, unknown> | null | undefined,
): Record<string, unknown> {
  if (!raw || typeof raw !== "object") return {};
  const allowed = new Map(
    contactFieldsForVertical(vertical).map((f) => [f.key, f]),
  );
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(raw)) {
    const def = allowed.get(key);
    if (!def) continue;
    if (value === null || value === undefined || value === "") continue;
    if (def.type === "boolean") {
      out[key] = Boolean(value);
    } else if (def.type === "number") {
      const n = typeof value === "number" ? value : Number(value);
      if (!Number.isNaN(n)) out[key] = n;
    } else {
      out[key] = String(value).trim();
    }
  }
  return out;
}
