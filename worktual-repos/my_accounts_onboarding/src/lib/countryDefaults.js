import { getBranchCountry } from "./leads.js";

export const MOBILE_VALIDATION_RULES = {
  "+1": { country: "US / Canada", digits: 10, flag: "🇺🇸" },
  "+44": { country: "United Kingdom", digits: 10, flag: "🇬🇧" },
  "+91": { country: "India", digits: 10, flag: "🇮🇳" },
  "+61": { country: "Australia", digits: 9, flag: "🇦🇺" },
  "+65": { country: "Singapore", digits: 8, flag: "🇸🇬" },
  "+971": { country: "United Arab Emirates", digits: 9, flag: "🇦🇪" },
  "+49": { country: "Germany", digits: 11, flag: "🇩🇪" },
  "+33": { country: "France", digits: 9, flag: "🇫🇷" },
};

export const LEAD_COUNTRY_DEFAULTS = {
  India: {
    dialCode: "+91",
    pricingRegion: "India",
    currency: "INR",
    taxLabel: "GST",
    taxFieldLabel: "GST Number",
    taxPlaceholder: "Example: 29AABCH1234A1Z5",
  },
  "United States": {
    dialCode: "+1",
    pricingRegion: "UK",
    currency: "GBP",
    taxLabel: "VAT",
    taxFieldLabel: "Tax ID",
    taxPlaceholder: "Enter tax identification number",
  },
  "United Kingdom": {
    dialCode: "+44",
    pricingRegion: "UK",
    currency: "GBP",
    taxLabel: "VAT",
    taxFieldLabel: "VAT Number",
    taxPlaceholder: "Example: GB123456789",
  },
  Australia: {
    dialCode: "+61",
    pricingRegion: "UK",
    currency: "GBP",
    taxLabel: "VAT",
    taxFieldLabel: "ABN / Tax Number",
    taxPlaceholder: "Enter ABN or tax number",
  },
  Singapore: {
    dialCode: "+65",
    pricingRegion: "UK",
    currency: "GBP",
    taxLabel: "VAT",
    taxFieldLabel: "GST Number",
    taxPlaceholder: "Enter GST registration number",
  },
  Canada: {
    dialCode: "+1",
    pricingRegion: "UK",
    currency: "GBP",
    taxLabel: "VAT",
    taxFieldLabel: "Tax ID",
    taxPlaceholder: "Enter tax identification number",
  },
  "United Arab Emirates": {
    dialCode: "+971",
    pricingRegion: "Dubai",
    currency: "AED",
    taxLabel: "VAT",
    taxFieldLabel: "VAT Number",
    taxPlaceholder: "Enter TRN / VAT number",
  },
  Germany: {
    dialCode: "+49",
    pricingRegion: "UK",
    currency: "GBP",
    taxLabel: "VAT",
    taxFieldLabel: "VAT Number",
    taxPlaceholder: "Enter VAT number",
  },
  France: {
    dialCode: "+33",
    pricingRegion: "UK",
    currency: "GBP",
    taxLabel: "VAT",
    taxFieldLabel: "VAT Number",
    taxPlaceholder: "Enter VAT number",
  },
  Other: {
    dialCode: "+91",
    pricingRegion: "India",
    currency: "INR",
    taxLabel: "GST",
    taxFieldLabel: "Tax Number",
    taxPlaceholder: "Enter tax number",
  },
};

const FALLBACK_COUNTRY_DEFAULTS = LEAD_COUNTRY_DEFAULTS.India;

export function getLeadCountryDefaults(country = "") {
  return LEAD_COUNTRY_DEFAULTS[country] || FALLBACK_COUNTRY_DEFAULTS;
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

export function trimMobileNumberForDialCode(value, dialCode) {
  const digits = MOBILE_VALIDATION_RULES[dialCode]?.digits ?? 10;
  return String(value || "")
    .replace(/\D/g, "")
    .slice(0, digits);
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
