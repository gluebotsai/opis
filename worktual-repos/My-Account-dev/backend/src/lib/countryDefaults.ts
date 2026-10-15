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
    divisions: INDIAN_STATES as string[] | null,
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
    divisions: US_STATES as string[] | null,
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
    divisions: UK_COUNTIES as string[] | null,
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
    divisions: AUSTRALIA_STATES as string[] | null,
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
    divisions: SINGAPORE_REGIONS as string[] | null,
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
    divisions: CANADA_PROVINCES as string[] | null,
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
    divisions: UAE_EMIRATES as string[] | null,
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
    divisions: GERMANY_STATES as string[] | null,
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
    divisions: FRANCE_REGIONS as string[] | null,
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
    divisions: null as string[] | null,
  },
};

const FALLBACK_COUNTRY_DEFAULTS = LEAD_COUNTRY_DEFAULTS.India;

export function getStateOptionsForCountry(country: any = "") {
  return (LEAD_COUNTRY_DEFAULTS as Record<string, any>)[country]?.divisions || null;
}

/** Human label for the administrative division field ("State", "County", "Emirate", …). */
export function getDivisionLabelForCountry(country: any = "") {
  return getLeadCountryDefaults(country).divisionLabel || "State/Province";
}

/** Free-text fallback placeholder when no curated division list exists for the country. */
export function getDivisionPlaceholderForCountry(country: any = "") {
  const label = getDivisionLabelForCountry(country);
  return `Enter ${label.toLowerCase()}`;
}

export function requiresStateForCountry(country: any = "") {
  return country === "India";
}

export function getLeadCountryDefaults(country: any = "") {
  return (LEAD_COUNTRY_DEFAULTS as Record<string, any>)[country] || FALLBACK_COUNTRY_DEFAULTS;
}

/** Invoice tax rate for the buyer's country (India GST 18%, UK VAT 20%, UAE VAT 5%, …). */
export function getTaxRateForCountry(country: any = "") {
  const rate = Number(getLeadCountryDefaults(country).taxRate);
  return Number.isFinite(rate) && rate >= 0 ? rate : 0.18;
}

/** True when the country uses Indian GST (CGST/SGST/IGST) invoicing. */
export function usesGstTaxSystem(country: any = "") {
  return String(getLeadCountryDefaults(country).taxLabel || "").toUpperCase() === "GST";
}

export function getPricingRegionForCountry(country: any = "") {
  return getLeadCountryDefaults(country).pricingRegion;
}

export function getBranchCountryDefaults(lead: any, branchId: any) {
  return getLeadCountryDefaults(getBranchCountry(lead, branchId));
}

export function getDialCodeForCountry(country: any = "") {
  return getLeadCountryDefaults(country).dialCode;
}

export function trimMobileNumberForDialCode(value: any, dialCode: any) {
  const digits = (MOBILE_VALIDATION_RULES as Record<string, any>)[dialCode]?.digits ?? 10;
  return String(value || "")
    .replace(/\D/g, "")
    .slice(0, digits);
}

/** Pattern for HTML `pattern` attribute (full-value match; no ^/$). */
export function mobileInputPattern(dialCode: any) {
  const rule = (MOBILE_VALIDATION_RULES as Record<string, any>)[dialCode];
  if (!rule) {
    return "\\d+";
  }
  if (rule.pattern) {
    return String(rule.pattern).replace(/^\^/, "").replace(/\$$/, "");
  }
  return `\\d{${rule.digits}}`;
}

export function mobileValidationMessage(dialCode: any) {
  const rule = (MOBILE_VALIDATION_RULES as Record<string, any>)[dialCode];
  if (!rule) {
    return "Enter a valid mobile number.";
  }
  if (rule.prefixMessage) {
    return `${rule.country} mobile numbers must contain exactly ${rule.digits} digits and start with 6, 7, 8, or 9.`;
  }
  return `${rule.country} mobile numbers must contain exactly ${rule.digits} digits.`;
}

/**
 * Empty is OK. Otherwise enforces dial-code length and any prefix/pattern rule.
 * @returns {string} error message or ""
 */
export function validateMobileForDialCode(dialCode: any, value: any) {
  const digits = String(value || "").replace(/\D/g, "");
  if (!digits) {
    return "";
  }

  const rule = (MOBILE_VALIDATION_RULES as Record<string, any>)[dialCode];
  if (!rule) {
    return "";
  }

  if (digits.length !== rule.digits) {
    return `${rule.country} mobile numbers must contain exactly ${rule.digits} digits.`;
  }

  if (rule.pattern) {
    const matcher = new RegExp(rule.pattern);
    if (!matcher.test(digits)) {
      return rule.prefixMessage || mobileValidationMessage(dialCode);
    }
  }

  return "";
}

export function applyCountryDefaultsToLeadForm(current: any, country: any) {
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
