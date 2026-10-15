import { normalizeLeadDialCode } from "./countryDefaults.js";
import { INDUSTRY_OPTIONS, INDUSTRY_OTHER } from "./leads.js";

export function resolveBranchIndustry(entry) {
  if (entry.industrySelection === INDUSTRY_OTHER) {
    return String(entry.customIndustryType || "").trim();
  }

  return String(entry.industrySelection || entry.industryType || "").trim();
}

export function industryToBranchForm(industryType = "") {
  const value = String(industryType || "").trim();
  if (!value) {
    return { industrySelection: "", customIndustryType: "" };
  }

  if (INDUSTRY_OPTIONS.includes(value)) {
    return { industrySelection: value, customIndustryType: "" };
  }

  return { industrySelection: INDUSTRY_OTHER, customIndustryType: value };
}

export function createEmptyBranchAddress(country = "") {
  return {
    id: "",
    label: "",
    address: "",
    country: country || "",
    state: "",
    taxNumber: "",
    industrySelection: "",
    customIndustryType: "",
    businessType: "",
    companySize: "",
    websiteUrl: "",
    contactName: "",
    designation: "",
    workEmail: "",
    mobileCountryCode: "+91",
    mobileNumber: "",
    secondaryMobileCountryCode: "+91",
    secondaryMobileNumber: "",
  };
}

export function headquartersProfileFromForm(formData) {
  return {
    industrySelection: formData.industrySelection || "",
    customIndustryType: formData.customIndustryType || "",
    businessType: formData.businessType || "",
    country: formData.country || "",
    state: formData.state || "",
    companySize: formData.companySize || "",
    websiteUrl: formData.websiteUrl || "",
    contactName: formData.contactName || "",
    designation: formData.designation || "",
    workEmail: formData.workEmail || "",
    mobileCountryCode: formData.mobileCountryCode || "+91",
    mobileNumber: formData.mobileNumber || "",
    secondaryMobileCountryCode: formData.secondaryMobileCountryCode || "+91",
    secondaryMobileNumber: formData.secondaryMobileNumber || "",
    taxNumber: formData.taxNumber || "",
  };
}

export function branchEntryToProfile(entry) {
  return {
    industrySelection: entry.industrySelection || "",
    customIndustryType: entry.customIndustryType || "",
    businessType: entry.businessType || "",
    country: entry.country || "",
    state: entry.state || "",
    companySize: entry.companySize || "",
    websiteUrl: entry.websiteUrl || "",
    contactName: entry.contactName || "",
    designation: entry.designation || "",
    workEmail: entry.workEmail || "",
    mobileCountryCode: entry.mobileCountryCode || "+91",
    mobileNumber: entry.mobileNumber || "",
    secondaryMobileCountryCode: entry.secondaryMobileCountryCode || "+91",
    secondaryMobileNumber: entry.secondaryMobileNumber || "",
    taxNumber: entry.taxNumber || "",
  };
}

/** Head office + branches before `beforeIndex` — for copy-from dropdowns. */
export function buildProfileSources(formData, addresses, beforeIndex) {
  const sources = [
    {
      key: "hq",
      label: "Head office",
      profile: headquartersProfileFromForm(formData),
    },
  ];

  for (let index = 0; index < beforeIndex; index += 1) {
    const branch = addresses[index];
    sources.push({
      key: branch.id,
      label: branch.label?.trim() || `Branch ${index + 1}`,
      profile: branchEntryToProfile(branch),
    });
  }

  return sources;
}

export function branchAddressFromApi(entry, leadCountry = "") {
  const industryForm = industryToBranchForm(entry.industryType);
  return {
    id: entry.id,
    label: entry.label || "",
    address: entry.address || "",
    country: entry.country || leadCountry || "",
    state: entry.state || "",
    taxNumber: entry.taxNumber || "",
    ...industryForm,
    businessType: entry.businessType || "",
    companySize: entry.companySize || "",
    websiteUrl: entry.websiteUrl || "",
    contactName: entry.contactName || "",
    designation: entry.designation || "",
    workEmail: entry.workEmail || "",
    mobileCountryCode: entry.mobileCountryCode || "+91",
    mobileNumber: entry.mobileNumber || "",
    secondaryMobileCountryCode: entry.secondaryMobileCountryCode || "+91",
    secondaryMobileNumber: entry.secondaryMobileNumber || "",
  };
}

export function applyProfileToBranchEntry(entry, profile) {
  return {
    ...entry,
    industrySelection: profile.industrySelection ?? entry.industrySelection,
    customIndustryType: profile.customIndustryType ?? entry.customIndustryType,
    businessType: profile.businessType ?? entry.businessType,
    country: profile.country ?? entry.country,
    state: profile.state ?? entry.state,
    companySize: profile.companySize ?? entry.companySize,
    websiteUrl: profile.websiteUrl ?? entry.websiteUrl,
    contactName: profile.contactName ?? entry.contactName,
    designation: profile.designation ?? entry.designation,
    workEmail: profile.workEmail ?? entry.workEmail,
    mobileCountryCode: profile.mobileCountryCode ?? entry.mobileCountryCode,
    mobileNumber: profile.mobileNumber ?? entry.mobileNumber,
    secondaryMobileCountryCode:
      profile.secondaryMobileCountryCode ?? entry.secondaryMobileCountryCode,
    secondaryMobileNumber: profile.secondaryMobileNumber ?? entry.secondaryMobileNumber,
    taxNumber: profile.taxNumber ?? entry.taxNumber,
  };
}

export function branchAddressToPayload(entry, leadCountry = "") {
  return {
    id: entry.id,
    label: entry.label.trim() || "Branch",
    address: entry.address.trim(),
    country: entry.country.trim() || leadCountry,
    state: entry.state.trim(),
    taxNumber: entry.taxNumber.trim(),
    industryType: resolveBranchIndustry(entry),
    businessType: entry.businessType.trim(),
    companySize: entry.companySize.trim(),
    websiteUrl: entry.websiteUrl.trim(),
    contactName: entry.contactName.trim(),
    designation: entry.designation.trim(),
    workEmail: entry.workEmail.trim(),
    mobileCountryCode: normalizeLeadDialCode(entry.mobileCountryCode),
    mobileNumber: entry.mobileNumber.trim(),
    secondaryMobileCountryCode: normalizeLeadDialCode(entry.secondaryMobileCountryCode),
    secondaryMobileNumber: entry.secondaryMobileNumber.trim(),
  };
}
