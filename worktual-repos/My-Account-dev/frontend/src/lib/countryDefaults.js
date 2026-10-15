import { getBranchCountry } from "./leads.js";

export const MOBILE_VALIDATION_RULES = {
  "+1": { country: "US / Canada", digits: 10, flag: "🇺🇸" },
  "+44": { country: "United Kingdom", digits: 10, flag: "🇬🇧" },
  "+91": {
    country: "India",
    digits: 10,
    flag: "🇮🇳",
    pattern: "^[6-9]\\d{9}$",
    prefixMessage: "India mobile numbers must start with 6, 7, 8, or 9.",
  },
  "+61": { country: "Australia", digits: 9, flag: "🇦🇺" },
  "+65": { country: "Singapore", digits: 8, flag: "🇸🇬" },
  "+971": { country: "United Arab Emirates", digits: 9, flag: "🇦🇪" },
  "+49": { country: "Germany", digits: 11, flag: "🇩🇪" },
  "+33": { country: "France", digits: 9, flag: "🇫🇷" },
};

export const INDIAN_STATES = [
  "Andhra Pradesh",
  "Arunachal Pradesh",
  "Assam",
  "Bihar",
  "Chhattisgarh",
  "Goa",
  "Gujarat",
  "Haryana",
  "Himachal Pradesh",
  "Jharkhand",
  "Karnataka",
  "Kerala",
  "Madhya Pradesh",
  "Maharashtra",
  "Manipur",
  "Meghalaya",
  "Mizoram",
  "Nagaland",
  "Odisha",
  "Punjab",
  "Rajasthan",
  "Sikkim",
  "Tamil Nadu",
  "Telangana",
  "Tripura",
  "Uttar Pradesh",
  "Uttarakhand",
  "West Bengal",
  "Andaman and Nicobar Islands",
  "Chandigarh",
  "Dadra and Nagar Haveli and Daman and Diu",
  "Delhi",
  "Jammu and Kashmir",
  "Ladakh",
  "Lakshadweep",
  "Puducherry",
];

/** Ceremonial counties of England + the other UK nations — practical "county" dropdown for UK addresses. */
export const UK_COUNTIES = [
  "Bedfordshire",
  "Berkshire",
  "Bristol",
  "Buckinghamshire",
  "Cambridgeshire",
  "Cheshire",
  "Cornwall",
  "Cumbria",
  "Derbyshire",
  "Devon",
  "Dorset",
  "Durham",
  "East Sussex",
  "Essex",
  "Gloucestershire",
  "Greater London",
  "Greater Manchester",
  "Hampshire",
  "Herefordshire",
  "Hertfordshire",
  "Isle of Wight",
  "Kent",
  "Lancashire",
  "Leicestershire",
  "Lincolnshire",
  "Merseyside",
  "Norfolk",
  "North Yorkshire",
  "Northamptonshire",
  "Northumberland",
  "Nottinghamshire",
  "Oxfordshire",
  "Rutland",
  "Shropshire",
  "Somerset",
  "South Yorkshire",
  "Staffordshire",
  "Suffolk",
  "Surrey",
  "Tyne and Wear",
  "Warwickshire",
  "West Midlands",
  "West Sussex",
  "West Yorkshire",
  "Wiltshire",
  "Worcestershire",
  "Scotland",
  "Wales",
  "Northern Ireland",
];

export const US_STATES = [
  "Alabama",
  "Alaska",
  "Arizona",
  "Arkansas",
  "California",
  "Colorado",
  "Connecticut",
  "Delaware",
  "District of Columbia",
  "Florida",
  "Georgia",
  "Hawaii",
  "Idaho",
  "Illinois",
  "Indiana",
  "Iowa",
  "Kansas",
  "Kentucky",
  "Louisiana",
  "Maine",
  "Maryland",
  "Massachusetts",
  "Michigan",
  "Minnesota",
  "Mississippi",
  "Missouri",
  "Montana",
  "Nebraska",
  "Nevada",
  "New Hampshire",
  "New Jersey",
  "New Mexico",
  "New York",
  "North Carolina",
  "North Dakota",
  "Ohio",
  "Oklahoma",
  "Oregon",
  "Pennsylvania",
  "Rhode Island",
  "South Carolina",
  "South Dakota",
  "Tennessee",
  "Texas",
  "Utah",
  "Vermont",
  "Virginia",
  "Washington",
  "West Virginia",
  "Wisconsin",
  "Wyoming",
];

export const UAE_EMIRATES = [
  "Abu Dhabi",
  "Dubai",
  "Sharjah",
  "Ajman",
  "Umm Al Quwain",
  "Ras Al Khaimah",
  "Fujairah",
];

export const AUSTRALIA_STATES = [
  "New South Wales",
  "Victoria",
  "Queensland",
  "Western Australia",
  "South Australia",
  "Tasmania",
  "Australian Capital Territory",
  "Northern Territory",
];

export const CANADA_PROVINCES = [
  "Alberta",
  "British Columbia",
  "Manitoba",
  "New Brunswick",
  "Newfoundland and Labrador",
  "Northwest Territories",
  "Nova Scotia",
  "Nunavut",
  "Ontario",
  "Prince Edward Island",
  "Quebec",
  "Saskatchewan",
  "Yukon",
];

export const SINGAPORE_REGIONS = ["Central", "East", "North", "North-East", "West"];

export const GERMANY_STATES = [
  "Baden-Württemberg",
  "Bavaria",
  "Berlin",
  "Brandenburg",
  "Bremen",
  "Hamburg",
  "Hesse",
  "Lower Saxony",
  "Mecklenburg-Vorpommern",
  "North Rhine-Westphalia",
  "Rhineland-Palatinate",
  "Saarland",
  "Saxony",
  "Saxony-Anhalt",
  "Schleswig-Holstein",
  "Thuringia",
];

export const FRANCE_REGIONS = [
  "Auvergne-Rhône-Alpes",
  "Bourgogne-Franche-Comté",
  "Bretagne",
  "Centre-Val de Loire",
  "Corse",
  "Grand Est",
  "Hauts-de-France",
  "Île-de-France",
  "Normandie",
  "Nouvelle-Aquitaine",
  "Occitanie",
  "Pays de la Loire",
  "Provence-Alpes-Côte d'Azur",
];

export const LEAD_COUNTRY_DEFAULTS = {
  India: {
    dialCode: "+91",
    pricingRegion: "India",
    currency: "INR",
    taxLabel: "GST",
    taxRate: 0.18,
    taxFieldLabel: "GST Number",
    taxPlaceholder: "Example: 29AABCH1234A1Z6",
    divisionLabel: "State",
    divisions: INDIAN_STATES,
  },
  "United States": {
    dialCode: "+1",
    pricingRegion: "UK",
    currency: "GBP",
    taxLabel: "VAT",
    taxRate: 0,
    taxFieldLabel: "Tax ID",
    taxPlaceholder: "Enter tax identification number",
    divisionLabel: "State",
    divisions: US_STATES,
  },
  "United Kingdom": {
    dialCode: "+44",
    pricingRegion: "UK",
    currency: "GBP",
    taxLabel: "VAT",
    taxRate: 0.2,
    taxFieldLabel: "VAT Number",
    taxPlaceholder: "Example: GB123456789",
    divisionLabel: "County",
    divisions: UK_COUNTIES,
  },
  Australia: {
    dialCode: "+61",
    pricingRegion: "UK",
    currency: "GBP",
    taxLabel: "VAT",
    taxRate: 0.1,
    taxFieldLabel: "ABN / Tax Number",
    taxPlaceholder: "Enter ABN or tax number",
    divisionLabel: "State/Territory",
    divisions: AUSTRALIA_STATES,
  },
  Singapore: {
    dialCode: "+65",
    pricingRegion: "UK",
    currency: "GBP",
    taxLabel: "VAT",
    taxRate: 0.09,
    taxFieldLabel: "GST Number",
    taxPlaceholder: "Enter GST registration number",
    divisionLabel: "Region",
    divisions: SINGAPORE_REGIONS,
  },
  Canada: {
    dialCode: "+1",
    pricingRegion: "UK",
    currency: "GBP",
    taxLabel: "VAT",
    taxRate: 0.05,
    taxFieldLabel: "Tax ID",
    taxPlaceholder: "Enter tax identification number",
    divisionLabel: "Province",
    divisions: CANADA_PROVINCES,
  },
  "United Arab Emirates": {
    dialCode: "+971",
    pricingRegion: "Dubai",
    currency: "AED",
    taxLabel: "VAT",
    taxRate: 0.05,
    taxFieldLabel: "VAT Number",
    taxPlaceholder: "Enter TRN / VAT number",
    divisionLabel: "Emirate",
    divisions: UAE_EMIRATES,
  },
  Germany: {
    dialCode: "+49",
    pricingRegion: "UK",
    currency: "GBP",
    taxLabel: "VAT",
    taxRate: 0.19,
    taxFieldLabel: "VAT Number",
    taxPlaceholder: "Enter VAT number",
    divisionLabel: "State",
    divisions: GERMANY_STATES,
  },
  France: {
    dialCode: "+33",
    pricingRegion: "UK",
    currency: "GBP",
    taxLabel: "VAT",
    taxRate: 0.2,
    taxFieldLabel: "VAT Number",
    taxPlaceholder: "Enter VAT number",
    divisionLabel: "Region",
    divisions: FRANCE_REGIONS,
  },
  Other: {
    dialCode: "+91",
    pricingRegion: "UK",
    currency: "GBP",
    taxLabel: "VAT",
    taxRate: 0.2,
    taxFieldLabel: "Tax Number",
    taxPlaceholder: "Enter tax number",
    divisionLabel: "State/Province",
    divisions: null,
  },
};

const FALLBACK_COUNTRY_DEFAULTS = LEAD_COUNTRY_DEFAULTS.India;

/**
 * Dropdown options for the administrative division (state/province/county/emirate) of a
 * country. Returns `null` when no curated list exists yet for that country — callers should
 * fall back to a free-text input in that case (see `getDivisionLabelForCountry`).
 */
export function getStateOptionsForCountry(country = "") {
  return LEAD_COUNTRY_DEFAULTS[country]?.divisions || null;
}

/** Human label for the administrative division field ("State", "County", "Emirate", …). */
export function getDivisionLabelForCountry(country = "") {
  return getLeadCountryDefaults(country).divisionLabel || "State/Province";
}

/** Free-text fallback placeholder when no curated division list exists for the country. */
export function getDivisionPlaceholderForCountry(country = "") {
  const label = getDivisionLabelForCountry(country);
  return `Enter ${label.toLowerCase()}`;
}

export function requiresStateForCountry(country = "") {
  return country === "India";
}

export function getLeadCountryDefaults(country = "") {
  return LEAD_COUNTRY_DEFAULTS[country] || FALLBACK_COUNTRY_DEFAULTS;
}

/** Invoice tax rate for the buyer's country (India GST 18%, UK VAT 20%, UAE VAT 5%, …). */
export function getTaxRateForCountry(country = "") {
  const rate = Number(getLeadCountryDefaults(country).taxRate);
  return Number.isFinite(rate) && rate >= 0 ? rate : 0.18;
}

/** True when the country uses Indian GST (CGST/SGST/IGST) invoicing. */
export function usesGstTaxSystem(country = "") {
  return String(getLeadCountryDefaults(country).taxLabel || "").toUpperCase() === "GST";
}

export function getPricingRegionForCountry(country = "") {
  return getLeadCountryDefaults(country).pricingRegion;
}

export function getBranchCountryDefaults(lead, branchId) {
  return getLeadCountryDefaults(getBranchCountry(lead, branchId));
}

export function getDialCodeForCountry(country = "") {
  return getLeadCountryDefaults(country).dialCode;
}

/**
 * Resolve a country name for a dial code. Prefer the current country when it
 * already matches (e.g. Canada stays Canada for +1); otherwise first catalog match.
 */
export function getCountryForDialCode(dialCode = "", currentCountry = "") {
  const code = String(dialCode || "").trim();
  const current = String(currentCountry || "").trim();
  if (!code || !MOBILE_VALIDATION_RULES[code]) {
    return current || "India";
  }

  if (current && LEAD_COUNTRY_DEFAULTS[current]?.dialCode === code) {
    return current;
  }

  if (code === "+1") {
    return current === "Canada" ? "Canada" : "United States";
  }

  const match = Object.entries(LEAD_COUNTRY_DEFAULTS).find(
    ([name, defaults]) => name !== "Other" && defaults.dialCode === code,
  );
  return match?.[0] || current || "India";
}

export function trimMobileNumberForDialCode(value, dialCode) {
  const digits = MOBILE_VALIDATION_RULES[dialCode]?.digits ?? 10;
  return String(value || "")
    .replace(/\D/g, "")
    .slice(0, digits);
}

/** Pattern for HTML `pattern` attribute (full-value match; no ^/$). */
export function mobileInputPattern(dialCode) {
  const rule = MOBILE_VALIDATION_RULES[dialCode];
  if (!rule) {
    return "\\d+";
  }
  if (rule.pattern) {
    return String(rule.pattern).replace(/^\^/, "").replace(/\$$/, "");
  }
  return `\\d{${rule.digits}}`;
}

export function mobileValidationMessage(dialCode) {
  const rule = MOBILE_VALIDATION_RULES[dialCode];
  if (!rule) {
    return "Enter a valid mobile number.";
  }
  if (rule.prefixMessage) {
    return `${rule.country} mobile numbers must contain exactly ${rule.digits} digits and start with 6, 7, 8, or 9.`;
  }
  return `${rule.country} mobile numbers must contain exactly ${rule.digits} digits.`;
}

/**
 * Empty number is OK unless required elsewhere. When digits are present, dial code
 * must be a known rule. Enforces length and any prefix/pattern rule.
 * @returns {string} error message or ""
 */
export function validateMobileForDialCode(dialCode, value) {
  const digits = String(value || "").replace(/\D/g, "");
  const code = String(dialCode || "").trim();
  if (!digits) {
    return "";
  }

  const rule = MOBILE_VALIDATION_RULES[code];
  if (!rule) {
    return "Please select a country code.";
  }

  if (digits.length !== rule.digits) {
    return `${rule.country} mobile numbers must contain exactly ${rule.digits} digits.`;
  }

  if (rule.pattern) {
    const matcher = new RegExp(rule.pattern);
    if (!matcher.test(digits)) {
      return rule.prefixMessage || mobileValidationMessage(code);
    }
  }

  return "";
}

/** Known dial codes only; falls back when empty/unknown. */
export function normalizeLeadDialCode(dialCode, fallback = "+91") {
  const code = String(dialCode || "").trim();
  if (code && MOBILE_VALIDATION_RULES[code]) {
    return code;
  }
  return fallback;
}

const DIAL_CODES_LONGEST_FIRST = Object.keys(MOBILE_VALIDATION_RULES).sort(
  (left, right) => right.length - left.length,
);

/** Split a stored E.164-ish value into dial code + national digits. */
export function splitPhoneNumber(value, fallbackDialCode = "+91") {
  const raw = String(value || "").trim();
  const fallback = normalizeLeadDialCode(fallbackDialCode, "+91");
  for (const code of DIAL_CODES_LONGEST_FIRST) {
    if (raw.startsWith(code)) {
      return {
        dialCode: code,
        national: trimMobileNumberForDialCode(raw.slice(code.length), code),
      };
    }
  }
  return {
    dialCode: fallback,
    national: trimMobileNumberForDialCode(raw, fallback),
  };
}

export function composePhoneNumber(dialCode, national) {
  const code = normalizeLeadDialCode(dialCode, "+91");
  return `${code}${trimMobileNumberForDialCode(national, code)}`;
}

export function applyCountryDefaultsToLeadForm(current, country) {
  const defaults = getLeadCountryDefaults(country);
  const dialCode = defaults.dialCode;

  return {
    ...current,
    country,
    mobileCountryCode: dialCode,
    secondaryMobileCountryCode: dialCode,
    mobileNumber: trimMobileNumberForDialCode(current.mobileNumber, dialCode),
    secondaryMobileNumber: trimMobileNumberForDialCode(current.secondaryMobileNumber, dialCode),
  };
}
