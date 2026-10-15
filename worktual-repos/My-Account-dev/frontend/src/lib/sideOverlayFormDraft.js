/** Shared empty/dirty checks for right-side overlay forms (admin + account settings). */

function normalizeText(value) {
  return String(value ?? "").trim();
}

function normalizeFormObject(obj, { ignoreKeys = [] } = {}) {
  if (!obj) {
    return null;
  }

  const result = {};
  for (const [key, value] of Object.entries(obj)) {
    if (ignoreKeys.includes(key)) {
      continue;
    }
    if (typeof value === "boolean") {
      result[key] = value;
    } else {
      result[key] = normalizeText(value);
    }
  }
  return result;
}

export function isFormStateDirty(current, baseline, options = {}) {
  if (!baseline) {
    return false;
  }

  return (
    JSON.stringify(normalizeFormObject(current, options)) !==
    JSON.stringify(normalizeFormObject(baseline, options))
  );
}

export function isFormStateEmpty(current, emptyBaseline, options = {}) {
  return (
    JSON.stringify(normalizeFormObject(current, options)) ===
    JSON.stringify(normalizeFormObject(emptyBaseline, options))
  );
}

/**
 * Whether dismissing an overlay should minimize to the draft island
 * instead of closing immediately.
 */
export function shouldSideOverlayMinimizeOnDismiss(
  formData,
  { isEditMode = false, baseline = null, emptyBaseline = null, isEmpty = null } = {},
) {
  if (isEditMode) {
    return isFormStateDirty(formData, baseline);
  }

  if (typeof isEmpty === "function") {
    return !isEmpty(formData);
  }

  if (emptyBaseline) {
    return !isFormStateEmpty(formData, emptyBaseline);
  }

  return false;
}

export const emptyUserCreateForm = {
  email: "",
  password: "",
  role: "sales",
  displayName: "",
  country: "India",
  mobileCountryCode: "+91",
  mobileNumber: "",
  isActive: true,
};

export const emptyCommissionSlabForm = {
  minAmount: "0",
  maxAmount: "",
  ratePercent: "",
  isActive: true,
};

export function isUserCreateFormEmpty(form) {
  return isFormStateEmpty(form, emptyUserCreateForm);
}

export function isUserEditFormDirty(form, baseline) {
  return isFormStateDirty(form, baseline);
}

export function isUserBulkUploadDirty({ bulkCsvText, bulkFileName, bulkValidRows = [] } = {}) {
  return Boolean(
    normalizeText(bulkCsvText) ||
      normalizeText(bulkFileName) ||
      (Array.isArray(bulkValidRows) && bulkValidRows.length > 0),
  );
}

const PARTNER_TEXT_FIELDS = [
  "companyName",
  "contactName",
  "workEmail",
  "websiteUrl",
  "mobileNumber",
  "password",
  "displayName",
  "accountHolderName",
  "bankName",
  "accountNumber",
  "ifscOrRouting",
  "branchName",
];

export function isPartnerCreateFormEmpty(form) {
  if (PARTNER_TEXT_FIELDS.some((field) => normalizeText(form?.[field]))) {
    return false;
  }
  return true;
}

export function isPartnerEditFormDirty(form, baseline) {
  return isFormStateDirty(form, baseline);
}

const RESELLER_TEXT_FIELDS = [
  "companyName",
  "contactName",
  "workEmail",
  "invoiceEmail",
  "invoiceCcEmails",
  "taxNumber",
  "billingAddress",
  "websiteUrl",
  "mobileNumber",
  "password",
  "displayName",
];

export function isResellerCreateFormEmpty(form) {
  if (RESELLER_TEXT_FIELDS.some((field) => normalizeText(form?.[field]))) {
    return false;
  }
  return true;
}

export function isResellerEditFormDirty(form, baseline) {
  return isFormStateDirty(form, baseline);
}

export function isCommissionSlabCreateFormEmpty(form) {
  return isFormStateEmpty(form, emptyCommissionSlabForm);
}

export function isCommissionSlabEditFormDirty(form, baseline) {
  return isFormStateDirty(form, baseline);
}

export function isAccountSettingsFormDirty(form, baseline) {
  if (!baseline) {
    return false;
  }

  const profileKeys = ["displayName", "email", "phone", "department"];
  if (profileKeys.some((key) => normalizeText(form?.[key]) !== normalizeText(baseline?.[key]))) {
    return true;
  }

  return Boolean(normalizeText(form?.currentPassword) || normalizeText(form?.password));
}

export function isSupportRaiseTicketFormEmpty(form) {
  if (!form) {
    return true;
  }

  if (form.unableToUse || form.startedAfterChange) {
    return false;
  }

  if (normalizeText(form.subject) || normalizeText(form.description)) {
    return false;
  }

  if (form.productSelection && form.productSelection !== "account") {
    return false;
  }

  return true;
}
