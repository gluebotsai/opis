import { verifyGstinRemote } from "./gstin-check.js";

/** Tax / GSTIN helpers for lead create/update validation. */

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

function normalizeStateName(value: any) {
  const raw = String(value || "").trim();
  if (!raw) {
    return "";
  }
  const alias = (STATE_NAME_ALIASES as any)[raw.toLowerCase()];
  return alias || raw;
}

/** Map an Indian state/UT display name to its GST state code. */
export function gstStateCodeForName(stateName: any) {
  const normalized = normalizeStateName(stateName);
  if (!normalized) {
    return "";
  }
  const match = Object.entries(GST_STATES).find(
    ([, name]) => name.toLowerCase() === normalized.toLowerCase(),
  );
  return match?.[0] || "";
}

export function sanitizeTaxNumberInput(value: any) {
  return String(value || "")
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "");
}

export function normalizeTaxNumber(taxNumber: any) {
  return sanitizeTaxNumberInput(taxNumber);
}

/** Build a 15-char alphanumeric GSTIN fixture (no checksum). */
export function gstinWithChecksum(firstFourteen: any) {
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
 * @returns {{ valid: boolean, reason?: string, gstin?: string, stateCode?: string, state?: string }}
 */
export function validateGstin(value: any, { expectedStateName = "" }: any = {}) {
  const gstin = normalizeTaxNumber(value);

  if (gstin.length !== 15) {
    return { valid: false, reason: "GSTIN must be exactly 15 characters." };
  }

  const stateCode = gstin.slice(0, 2);
  if (!/^[0-9]{2}$/.test(stateCode) || !(GST_STATES as any)[stateCode]) {
    return { valid: false, reason: "Invalid GST state code." };
  }

  if (!/^[A-Z]{5}$/.test(gstin.slice(2, 7))) {
    return { valid: false, reason: "GSTIN characters 3–7 must be 5 capital letters." };
  }
  if (!/^[0-9]{4}$/.test(gstin.slice(7, 11))) {
    return { valid: false, reason: "GSTIN characters 8–11 must be 4 digits." };
  }
  if (!/^[A-Z]$/.test((gstin[11] as any))) {
    return { valid: false, reason: "GSTIN character 12 must be a capital letter." };
  }
  if (!/^[0-9]$/.test((gstin[12] as any))) {
    return { valid: false, reason: "GSTIN character 13 must be a digit." };
  }
  if (gstin[13] !== "Z") {
    return { valid: false, reason: 'GSTIN character 14 must be "Z".' };
  }
  if (!/^[A-Z0-9]$/.test((gstin[14] as any))) {
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
    state: (GST_STATES as any)[stateCode],
  };
}

export function isValidGstin(value: any, options: any = {}) {
  return validateGstin(value, options).valid;
}

export function validateTaxNumberForCountry(country: any, value: any, { state = "" }: any = {}) {
  const taxNumber = normalizeTaxNumber(value);
  if (!taxNumber) {
    return "";
  }

  const countryName = String(country || "").trim();
  if (countryName === "India" || countryName === "IN") {
    const result = validateGstin(taxNumber, { expectedStateName: state });
    return result.valid ? "" : result.reason || "Enter a valid GSTIN.";
  }

  if (!/^[A-Z0-9]+$/.test(taxNumber)) {
    return "Tax number may only contain letters and numbers.";
  }

  return "";
}

export async function assertValidLeadTaxNumbers(payload: any = {}) {
  const country = (payload as any).country || "India";
  const hqTax = normalizeTaxNumber((payload as any).taxNumber);
  if (hqTax) {
    const hqError = validateTaxNumberForCountry(country, (payload as any).taxNumber, {
      state: (payload as any).state || "",
    });
    if (hqError) {
      throw new Error(hqError);
    }

    if (country === "India" || country === "IN") {
      const remote = await verifyGstinRemote(hqTax);
      if (!remote.valid && !remote.creditsExceeded) {
        throw new Error(remote.reason || "Enter a valid GSTIN.");
      }
    }
  }

  for (const entry of (payload as any).additionalAddresses || []) {
    const branchCountry = entry.country || country;
    const label = entry.label || "Branch";
    const branchTax = normalizeTaxNumber(entry.taxNumber);
    if (!branchTax) {
      continue;
    }

    const branchError = validateTaxNumberForCountry(branchCountry, entry.taxNumber, {
      state: entry.state || "",
    });
    if (branchError) {
      throw new Error(`${label}: ${branchError}`);
    }

    if (branchCountry === "India" || branchCountry === "IN") {
      const remote = await verifyGstinRemote(branchTax);
      if (!remote.valid && !remote.creditsExceeded) {
        throw new Error(`${label}: ${remote.reason || "Enter a valid GSTIN."}`);
      }
    }
  }
}
