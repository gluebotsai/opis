/**
 * Country-aware partner payout bank fields.
 * Profiles: India (IN), UAE (AE), United Kingdom (GB).
 */

export type PartnerBankProfileCode = "IN" | "AE" | "GB";

export type PartnerBankFieldKey =
  | "accountHolderName"
  | "bankName"
  | "accountNumber"
  | "ifscOrRouting"
  | "branchName"
  | "iban"
  | "swiftBic";

type PartnerBankField = {
  key: PartnerBankFieldKey;
  label: string;
  required: boolean;
};

const PROFILES: Record<
  PartnerBankProfileCode,
  { code: PartnerBankProfileCode; label: string; fields: PartnerBankField[] }
> = {
  IN: {
    code: "IN",
    label: "India",
    fields: [
      { key: "accountHolderName", label: "Account holder name", required: true },
      { key: "bankName", label: "Bank name", required: true },
      { key: "branchName", label: "Branch", required: false },
      { key: "accountNumber", label: "Account number", required: true },
      { key: "ifscOrRouting", label: "IFSC code", required: true },
    ],
  },
  AE: {
    code: "AE",
    label: "United Arab Emirates",
    fields: [
      { key: "accountHolderName", label: "Account holder name", required: true },
      { key: "bankName", label: "Bank name", required: true },
      { key: "iban", label: "IBAN", required: true },
      { key: "swiftBic", label: "SWIFT/BIC", required: false },
      { key: "branchName", label: "Branch", required: false },
    ],
  },
  GB: {
    code: "GB",
    label: "United Kingdom",
    fields: [
      { key: "accountHolderName", label: "Account holder name", required: true },
      { key: "accountNumber", label: "Account number", required: true },
      { key: "ifscOrRouting", label: "Sort code", required: true },
      { key: "bankName", label: "Bank name", required: false },
      { key: "iban", label: "IBAN", required: false },
      { key: "swiftBic", label: "SWIFT/BIC", required: false },
    ],
  },
};

export function resolvePartnerBankProfile(country = "") {
  const raw = String(country || "")
    .trim()
    .toLowerCase();
  if (
    raw.includes("united arab") ||
    raw === "uae" ||
    raw === "ae" ||
    raw.includes("dubai")
  ) {
    return PROFILES.AE;
  }
  if (
    raw.includes("united kingdom") ||
    raw === "uk" ||
    raw === "gb" ||
    raw === "great britain" ||
    raw === "england"
  ) {
    return PROFILES.GB;
  }
  return PROFILES.IN;
}

export function normalizePartnerBankPayload(payload: any = {}) {
  return {
    accountHolderName: String(payload.accountHolderName || "").trim(),
    bankName: String(payload.bankName || "").trim(),
    accountNumber: String(payload.accountNumber || "").trim(),
    ifscOrRouting: String(payload.ifscOrRouting || "").trim(),
    branchName: String(payload.branchName || "").trim(),
    iban: String(payload.iban || "").trim().replace(/\s+/g, "").toUpperCase(),
    swiftBic: String(payload.swiftBic || "").trim().replace(/\s+/g, "").toUpperCase(),
  };
}

export function validatePartnerBankPayload(payload: any = {}, country = "India") {
  const profile = resolvePartnerBankProfile(country);
  const normalized = normalizePartnerBankPayload(payload);
  for (const field of profile.fields) {
    if (!field.required) {
      continue;
    }
    if (!normalized[field.key]) {
      throw new Error(`${field.label} is required.`);
    }
  }

  // Clear fields that are not part of this country profile so stale values do not linger.
  const allowed = new Set(profile.fields.map((field) => field.key));
  const cleared = {
    accountHolderName: normalized.accountHolderName,
    bankName: allowed.has("bankName") ? normalized.bankName : "",
    accountNumber: allowed.has("accountNumber") ? normalized.accountNumber : "",
    ifscOrRouting: allowed.has("ifscOrRouting") ? normalized.ifscOrRouting : "",
    branchName: allowed.has("branchName") ? normalized.branchName : "",
    iban: allowed.has("iban") ? normalized.iban : "",
    swiftBic: allowed.has("swiftBic") ? normalized.swiftBic : "",
  };

  return { profile, values: cleared };
}
