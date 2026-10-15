import { fetchJson } from "./http.js";

/** Tax / GSTIN helpers shared by lead onboarding UI. */

export const GST_STATES = {
  "01": "Jammu & Kashmir",
  "02": "Himachal Pradesh",
  "03": "Punjab",
  "04": "Chandigarh",
  "05": "Uttarakhand",
  "06": "Haryana",
  "07": "Delhi",
  "08": "Rajasthan",
  "09": "Uttar Pradesh",
  "10": "Bihar",
  "11": "Sikkim",
  "12": "Arunachal Pradesh",
  "13": "Nagaland",
  "14": "Manipur",
  "15": "Mizoram",
  "16": "Tripura",
  "17": "Meghalaya",
  "18": "Assam",
  "19": "West Bengal",
  "20": "Jharkhand",
  "21": "Odisha",
  "22": "Chhattisgarh",
  "23": "Madhya Pradesh",
  "24": "Gujarat",
  "25": "Daman & Diu (Legacy)",
  "26": "Dadra & Nagar Haveli and Daman & Diu",
  "27": "Maharashtra",
  "28": "Andhra Pradesh (Legacy)",
  "29": "Karnataka",
  "30": "Goa",
  "31": "Lakshadweep",
  "32": "Kerala",
  "33": "Tamil Nadu",
  "34": "Puducherry",
  "35": "Andaman & Nicobar Islands",
  "36": "Telangana",
  "37": "Andhra Pradesh",
  "38": "Ladakh",
  "97": "Other Territory",
  "99": "Centre Jurisdiction",
};

const STATE_NAME_ALIASES = {
  "jammu and kashmir": "Jammu & Kashmir",
  "andaman and nicobar islands": "Andaman & Nicobar Islands",
  "dadra and nagar haveli and daman and diu": "Dadra & Nagar Haveli and Daman & Diu",
  "dadra & nagar haveli": "Dadra & Nagar Haveli and Daman & Diu",
  "daman & diu": "Daman & Diu (Legacy)",
  "andra pradesh (old)": "Andhra Pradesh (Legacy)",
  "andhra pradesh (old)": "Andhra Pradesh (Legacy)",
  "andhra pradesh (legacy)": "Andhra Pradesh (Legacy)",
  "other territory": "Other Territory",
  "centre jurisdiction": "Centre Jurisdiction",
  "center jurisdiction": "Centre Jurisdiction",
};

function normalizeStateName(value) {
  const raw = String(value || "").trim();
  if (!raw) {
    return "";
  }
  const alias = STATE_NAME_ALIASES[raw.toLowerCase()];
  return alias || raw;
}

export function gstStateCodeForName(stateName) {
  const normalized = normalizeStateName(stateName);
  if (!normalized) {
    return "";
  }
  const match = Object.entries(GST_STATES).find(
    ([, name]) => name.toLowerCase() === normalized.toLowerCase(),
  );
  return match?.[0] || "";
}

/** Uppercase A–Z / 0–9 only; strips spaces and special characters. */
export function sanitizeTaxNumberInput(value) {
  return String(value || "")
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "");
}

/**
 * Sanitize while preserving caret for mid-string edits.
 * Controlled React inputs otherwise jump the caret to the end after each keystroke.
 */
export function sanitizeTaxNumberInputPreservingCaret(rawValue, caretIndex) {
  const raw = String(rawValue ?? "");
  const caret = Number.isFinite(caretIndex) ? Math.max(0, caretIndex) : raw.length;
  let keptBefore = 0;
  for (let i = 0; i < caret && i < raw.length; i += 1) {
    if (/[A-Za-z0-9]/.test(raw[i])) {
      keptBefore += 1;
    }
  }
  const value = sanitizeTaxNumberInput(raw);
  return {
    value,
    caret: Math.min(keptBefore, value.length),
  };
}

export function restoreTaxNumberCaret(input, caret) {
  if (!(input instanceof HTMLInputElement) || caret == null) {
    return;
  }
  const pos = Math.min(Math.max(0, Number(caret) || 0), input.value.length);
  try {
    input.setSelectionRange(pos, pos);
  } catch {
    /* some input types may not support selection ranges */
  }
}

export function normalizeTaxNumber(taxNumber) {
  return sanitizeTaxNumberInput(taxNumber);
}

/** Build a 15-char alphanumeric GSTIN fixture (no checksum). */
export function gstinWithChecksum(firstFourteen) {
  const base = normalizeTaxNumber(firstFourteen).slice(0, 14);
  if (base.length !== 14) {
    return "";
  }
  return `${base}0`;
}

/**
 * Structural GSTIN checks:
 * 15 chars, valid state code, PAN-style body, entity digit, Z, alphanumeric check char.
 * Optional match to the selected form state.
 */
export function validateGstin(value, { expectedStateName = "" } = {}) {
  const gstin = normalizeTaxNumber(value);

  if (gstin.length !== 15) {
    return { valid: false, reason: "GSTIN must be exactly 15 characters." };
  }

  const stateCode = gstin.slice(0, 2);
  if (!/^[0-9]{2}$/.test(stateCode) || !GST_STATES[stateCode]) {
    return { valid: false, reason: "Invalid GST state code." };
  }

  if (!/^[A-Z]{5}$/.test(gstin.slice(2, 7))) {
    return { valid: false, reason: "GSTIN characters 3–7 must be 5 capital letters." };
  }
  if (!/^[0-9]{4}$/.test(gstin.slice(7, 11))) {
    return { valid: false, reason: "GSTIN characters 8–11 must be 4 digits." };
  }
  if (!/^[A-Z]$/.test(gstin[11])) {
    return { valid: false, reason: "GSTIN character 12 must be a capital letter." };
  }
  if (!/^[0-9]$/.test(gstin[12])) {
    return { valid: false, reason: "GSTIN character 13 must be a digit." };
  }
  if (gstin[13] !== "Z") {
    return { valid: false, reason: 'GSTIN character 14 must be "Z".' };
  }
  if (!/^[A-Z0-9]$/.test(gstin[14])) {
    return { valid: false, reason: "GSTIN character 15 must be a letter or digit." };
  }

  const expectedStateCode = gstStateCodeForName(expectedStateName);
  if (expectedStateCode && expectedStateCode !== stateCode) {
    return {
      valid: false,
      reason: `GSTIN must start with ${expectedStateCode} for ${normalizeStateName(expectedStateName)}.`,
    };
  }

  return {
    valid: true,
    gstin,
    stateCode,
    state: GST_STATES[stateCode],
  };
}

export function isValidGstin(value, options = {}) {
  return validateGstin(value, options).valid;
}

/**
 * Empty is OK. For India, non-empty must be a valid GSTIN (optional state match).
 * @returns {string} error message or ""
 */
export function validateTaxNumberForCountry(country, value, { state = "" } = {}) {
  const taxNumber = normalizeTaxNumber(value);
  if (!taxNumber) {
    return "";
  }

  if (String(country || "").trim() === "India") {
    const result = validateGstin(taxNumber, { expectedStateName: state });
    return result.valid ? "" : result.reason || "Enter a valid GSTIN.";
  }

  return "";
}

/**
 * Local format check + remote gstincheck via server proxy.
 * @returns {Promise<{ valid: boolean, reason?: string, gstin?: string, legalName?: string, tradeName?: string, status?: string }>}
 */
export async function validateGstinRemote(gstin, { state = "" } = {}) {
  const local = validateGstin(gstin, { expectedStateName: state });
  if (!local.valid) {
    return {
      valid: false,
      reason: local.reason || "Enter a valid GSTIN.",
      gstin: local.gstin || normalizeTaxNumber(gstin),
    };
  }

  try {
    const data = await fetchJson("/api/v1/tax/gstin/validate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ gstin: local.gstin, state }),
    });
    return {
      valid: data?.valid === true,
      reason: data?.reason || (data?.valid ? "" : "GSTIN not found or invalid."),
      gstin: data?.gstin || local.gstin,
      legalName: data?.legalName || "",
      tradeName: data?.tradeName || "",
      status: data?.status || "",
      fallback: data?.fallback === true,
      skipped: data?.skipped === true,
    };
  } catch (error) {
    return {
      valid: false,
      reason: error instanceof Error ? error.message : "Could not verify GSTIN.",
      gstin: local.gstin,
    };
  }
}
