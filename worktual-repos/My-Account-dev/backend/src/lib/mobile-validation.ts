/** Mobile dial-code validation mirrored for lead/user API checks. */

export const MOBILE_VALIDATION_RULES = {
  "+1": { country: "US / Canada", digits: 10 },
  "+44": { country: "United Kingdom", digits: 10 },
  "+91": {
    country: "India",
    digits: 10,
    pattern: /^[6-9]\d{9}$/,
    prefixMessage: "India mobile numbers must start with 6, 7, 8, or 9.",
  },
  "+61": { country: "Australia", digits: 9 },
  "+65": { country: "Singapore", digits: 8 },
  "+971": { country: "United Arab Emirates", digits: 9 },
  "+49": { country: "Germany", digits: 11 },
  "+33": { country: "France", digits: 9 },
};

/**
 * Empty number is OK. When digits are present, dial code must be a known rule.
 * Enforces length and any prefix/pattern rule.
 * @returns {string} error message or ""
 */
export function validateMobileForDialCode(dialCode: any, value: any) {
  const digits = String(value || "").replace(/\D/g, "");
  const code = String(dialCode || "").trim();
  if (!digits) {
    return "";
  }

  const rule = (MOBILE_VALIDATION_RULES as Record<string, any>)[code];
  if (!rule) {
    return "Please select a country code.";
  }

  if (digits.length !== rule.digits) {
    return `${rule.country} mobile numbers must contain exactly ${rule.digits} digits.`;
  }

  if (rule.pattern && !rule.pattern.test(digits)) {
    return rule.prefixMessage || `${rule.country} mobile number is invalid.`;
  }

  return "";
}

/** Known dial codes only; falls back when empty/unknown. */
export function normalizeLeadDialCode(dialCode: any, fallback = "+91") {
  const code = String(dialCode || "").trim();
  if (code && (MOBILE_VALIDATION_RULES as Record<string, any>)[code]) {
    return code;
  }
  return fallback;
}

const DIAL_CODES_LONGEST_FIRST = Object.keys(MOBILE_VALIDATION_RULES).sort(
  (left, right) => right.length - left.length,
);

/** Split a stored E.164-ish value into dial code + national digits. */
export function splitPhoneNumber(value: any, fallbackDialCode = "+91") {
  const raw = String(value || "").trim();
  const fallback = normalizeLeadDialCode(fallbackDialCode, "+91");
  for (const code of DIAL_CODES_LONGEST_FIRST) {
    if (raw.startsWith(code)) {
      const national = String(raw.slice(code.length) || "").replace(/\D/g, "");
      return { dialCode: code, national };
    }
  }
  return { dialCode: fallback, national: raw.replace(/\D/g, "") };
}

export function composePhoneNumber(dialCode: any, national: any) {
  const code = normalizeLeadDialCode(dialCode, "+91");
  const digits = String(national || "").replace(/\D/g, "");
  return `${code}${digits}`;
}

/** Require a complete valid number for mapping / available pool. */
export function assertValidPhoneNumber(value: any, dialCodeHint = "") {
  const { dialCode, national } = splitPhoneNumber(value, dialCodeHint || "+91");
  if (!national) {
    throw new Error("Number is required.");
  }
  const error = validateMobileForDialCode(dialCode, national);
  if (error) {
    throw new Error(error);
  }
  return composePhoneNumber(dialCode, national);
}

export function assertValidLeadMobiles(payload: any = {}) {
  if (!String(payload.mobileNumber || "").trim()) {
    throw new Error("Mobile number is required.");
  }

  const primaryCode = String(payload.mobileCountryCode || "").trim();
  if (!primaryCode || !(MOBILE_VALIDATION_RULES as Record<string, any>)[primaryCode]) {
    throw new Error("Mobile country code is required.");
  }

  const hqPrimary = validateMobileForDialCode(primaryCode, payload.mobileNumber);
  if (hqPrimary) {
    throw new Error(hqPrimary);
  }

  // Secondary mobile is optional; validate format only when provided.
  if (String(payload.secondaryMobileNumber || "").trim()) {
    const secondaryCode = String(payload.secondaryMobileCountryCode || "").trim();
    if (!secondaryCode || !(MOBILE_VALIDATION_RULES as Record<string, any>)[secondaryCode]) {
      throw new Error("Secondary mobile country code is required.");
    }
  }
  const hqSecondary = validateMobileForDialCode(
    payload.secondaryMobileCountryCode,
    payload.secondaryMobileNumber,
  );
  if (hqSecondary) {
    throw new Error(hqSecondary);
  }

  for (const [index, entry] of (payload.additionalAddresses || []).entries()) {
    const label = String(entry?.label || "").trim() || `Branch ${index + 1}`;
    if (!String(entry?.mobileNumber || "").trim()) {
      throw new Error(`${label}: Mobile number is required.`);
    }
    const branchCode = String(entry?.mobileCountryCode || "").trim();
    if (!branchCode || !(MOBILE_VALIDATION_RULES as Record<string, any>)[branchCode]) {
      throw new Error(`${label}: Mobile country code is required.`);
    }
    const primary = validateMobileForDialCode(branchCode, entry?.mobileNumber);
    if (primary) {
      throw new Error(`${label}: ${primary}`);
    }
    if (String(entry?.secondaryMobileNumber || "").trim()) {
      const branchSecondaryCode = String(entry?.secondaryMobileCountryCode || "").trim();
      if (
        !branchSecondaryCode ||
        !(MOBILE_VALIDATION_RULES as Record<string, any>)[branchSecondaryCode]
      ) {
        throw new Error(`${label}: Secondary mobile country code is required.`);
      }
    }
    const secondary = validateMobileForDialCode(
      entry?.secondaryMobileCountryCode,
      entry?.secondaryMobileNumber,
    );
    if (secondary) {
      throw new Error(`${label}: ${secondary}`);
    }
  }
}
