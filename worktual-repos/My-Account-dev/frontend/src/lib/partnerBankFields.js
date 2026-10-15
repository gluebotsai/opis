/**
 * Partner payout bank form fields by partner country.
 * Keys map to API / partner_bank_accounts columns.
 */

export const PARTNER_BANK_PROFILES = {
  IN: {
    code: "IN",
    label: "India",
    fields: [
      { key: "accountHolderName", label: "Account holder name", required: true, fullWidth: true },
      { key: "bankName", label: "Bank name", required: true },
      { key: "branchName", label: "Branch (optional)", required: false },
      { key: "accountNumber", label: "Account number", required: true },
      { key: "ifscOrRouting", label: "IFSC code", required: true },
    ],
  },
  AE: {
    code: "AE",
    label: "United Arab Emirates",
    fields: [
      { key: "accountHolderName", label: "Account holder name", required: true, fullWidth: true },
      { key: "bankName", label: "Bank name", required: true },
      { key: "iban", label: "IBAN", required: true },
      { key: "swiftBic", label: "SWIFT/BIC (optional)", required: false },
      { key: "branchName", label: "Branch (optional)", required: false },
    ],
  },
  GB: {
    code: "GB",
    label: "United Kingdom",
    fields: [
      { key: "accountHolderName", label: "Account holder name", required: true, fullWidth: true },
      { key: "accountNumber", label: "Account number", required: true },
      { key: "ifscOrRouting", label: "Sort code", required: true },
      { key: "bankName", label: "Bank name (optional)", required: false },
      { key: "iban", label: "IBAN (optional)", required: false },
      { key: "swiftBic", label: "SWIFT/BIC (optional)", required: false },
    ],
  },
};

export const EMPTY_PARTNER_BANK_FORM = {
  accountHolderName: "",
  bankName: "",
  accountNumber: "",
  ifscOrRouting: "",
  branchName: "",
  iban: "",
  swiftBic: "",
};

export function resolvePartnerBankProfile(country = "") {
  const raw = String(country || "").trim().toLowerCase();
  if (
    raw.includes("united arab") ||
    raw === "uae" ||
    raw === "ae" ||
    raw.includes("dubai")
  ) {
    return PARTNER_BANK_PROFILES.AE;
  }
  if (
    raw.includes("united kingdom") ||
    raw === "uk" ||
    raw === "gb" ||
    raw === "great britain" ||
    raw === "england"
  ) {
    return PARTNER_BANK_PROFILES.GB;
  }
  return PARTNER_BANK_PROFILES.IN;
}

export function bankFormFromAccount(account) {
  return {
    accountHolderName: account?.accountHolderName || "",
    bankName: account?.bankName || "",
    accountNumber: account?.accountNumber || "",
    ifscOrRouting: account?.ifscOrRouting || "",
    branchName: account?.branchName || "",
    iban: account?.iban || "",
    swiftBic: account?.swiftBic || "",
  };
}

export function validatePartnerBankForm(form, country = "") {
  const profile = resolvePartnerBankProfile(country);
  const errors = {};
  for (const field of profile.fields) {
    if (!field.required) {
      continue;
    }
    if (!String(form?.[field.key] || "").trim()) {
      errors[field.key] = `${field.label.replace(/\s*\(optional\)\s*$/i, "")} is required.`;
    }
  }
  return errors;
}

export function partnerBankPayload(form) {
  return {
    accountHolderName: String(form.accountHolderName || "").trim(),
    bankName: String(form.bankName || "").trim(),
    accountNumber: String(form.accountNumber || "").trim(),
    ifscOrRouting: String(form.ifscOrRouting || "").trim(),
    branchName: String(form.branchName || "").trim(),
    iban: String(form.iban || "").trim(),
    swiftBic: String(form.swiftBic || "").trim(),
  };
}

export function mapPartnerBankApiErrorToField(message) {
  const text = String(message || "").toLowerCase();
  if (text.includes("account holder")) {
    return "accountHolderName";
  }
  if (text.includes("bank name")) {
    return "bankName";
  }
  if (text.includes("account number")) {
    return "accountNumber";
  }
  if (text.includes("ifsc") || text.includes("sort code") || text.includes("routing")) {
    return "ifscOrRouting";
  }
  if (text.includes("iban")) {
    return "iban";
  }
  if (text.includes("swift") || text.includes("bic")) {
    return "swiftBic";
  }
  if (text.includes("branch")) {
    return "branchName";
  }
  return "";
}
