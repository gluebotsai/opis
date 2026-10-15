/** Normalize lead form state for empty/dirty comparisons (create + edit overlays). */

function normalizeText(value) {
  return String(value ?? "").trim();
}

function normalizeBranchEntry(entry) {
  if (!entry) {
    return null;
  }

  return {
    id: normalizeText(entry.id),
    label: normalizeText(entry.label),
    address: normalizeText(entry.address),
    country: normalizeText(entry.country),
    state: normalizeText(entry.state),
    taxNumber: normalizeText(entry.taxNumber),
    industrySelection: normalizeText(entry.industrySelection),
    customIndustryType: normalizeText(entry.customIndustryType),
    businessType: normalizeText(entry.businessType),
    companySize: normalizeText(entry.companySize),
    websiteUrl: normalizeText(entry.websiteUrl),
    contactName: normalizeText(entry.contactName),
    designation: normalizeText(entry.designation),
    workEmail: normalizeText(entry.workEmail),
    mobileCountryCode: normalizeText(entry.mobileCountryCode),
    mobileNumber: normalizeText(entry.mobileNumber),
    secondaryMobileCountryCode: normalizeText(entry.secondaryMobileCountryCode),
    secondaryMobileNumber: normalizeText(entry.secondaryMobileNumber),
  };
}

export function normalizeLeadFormState(formData) {
  if (!formData) {
    return null;
  }

  const additionalAddresses = (formData.additionalAddresses || [])
    .map(normalizeBranchEntry)
    .filter(Boolean);

  return {
    companyName: normalizeText(formData.companyName),
    industrySelection: normalizeText(formData.industrySelection),
    customIndustryType: normalizeText(formData.customIndustryType),
    businessType: normalizeText(formData.businessType),
    country: normalizeText(formData.country),
    companySize: normalizeText(formData.companySize),
    contactName: normalizeText(formData.contactName),
    designation: normalizeText(formData.designation),
    isDecisionMaker: formData.isDecisionMaker !== false,
    decisionMakerName: normalizeText(formData.decisionMakerName),
    workEmail: normalizeText(formData.workEmail),
    mobileCountryCode: normalizeText(formData.mobileCountryCode),
    mobileNumber: normalizeText(formData.mobileNumber),
    secondaryMobileCountryCode: normalizeText(formData.secondaryMobileCountryCode),
    secondaryMobileNumber: normalizeText(formData.secondaryMobileNumber),
    billingAddress: normalizeText(formData.billingAddress),
    websiteUrl: normalizeText(formData.websiteUrl),
    hasMultipleAddresses: Boolean(formData.hasMultipleAddresses),
    additionalAddresses,
    adminEmail: normalizeText(formData.adminEmail),
    taxNumber: normalizeText(formData.taxNumber),
    state: normalizeText(formData.state),
  };
}

function isBranchEntryEmpty(entry) {
  if (!entry) {
    return true;
  }

  return ![
    entry.label,
    entry.address,
    entry.country,
    entry.state,
    entry.taxNumber,
    entry.industrySelection,
    entry.customIndustryType,
    entry.businessType,
    entry.companySize,
    entry.websiteUrl,
    entry.contactName,
    entry.designation,
    entry.workEmail,
    entry.mobileNumber,
    entry.secondaryMobileNumber,
  ].some((value) => normalizeText(value));
}

/** True when create-lead form has no user-entered content worth keeping as a draft. */
export function isLeadCreateDraftEmpty(formData) {
  const normalized = normalizeLeadFormState(formData);
  if (!normalized) {
    return true;
  }

  const textValues = [
    normalized.companyName,
    normalized.industrySelection,
    normalized.customIndustryType,
    normalized.businessType,
    normalized.country,
    normalized.companySize,
    normalized.websiteUrl,
    normalized.contactName,
    normalized.designation,
    normalized.workEmail,
    normalized.mobileNumber,
    normalized.secondaryMobileNumber,
    normalized.billingAddress,
    normalized.taxNumber,
    normalized.state,
    normalized.decisionMakerName,
    normalized.adminEmail,
  ];

  if (textValues.some(Boolean)) {
    return false;
  }

  if (normalized.hasMultipleAddresses) {
    return false;
  }

  if (normalized.additionalAddresses.some((entry) => !isBranchEntryEmpty(entry))) {
    return false;
  }

  return true;
}

/** True when edit form differs from the loaded baseline snapshot. */
export function isLeadFormDirty(formData, baseline) {
  if (!baseline) {
    return false;
  }

  const current = normalizeLeadFormState(formData);
  const initial = normalizeLeadFormState(baseline);
  return JSON.stringify(current) !== JSON.stringify(initial);
}

/**
 * Whether dismissing a lead overlay should minimize to the draft island
 * instead of closing immediately.
 */
export function shouldLeadOverlayMinimizeOnDismiss(formData, { isEditMode = false, baseline = null } = {}) {
  if (isEditMode) {
    return isLeadFormDirty(formData, baseline);
  }

  return !isLeadCreateDraftEmpty(formData);
}
