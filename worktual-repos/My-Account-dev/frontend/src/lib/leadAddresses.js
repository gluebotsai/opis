/**
 * Client-side mirror of server unique address rule for onboarding UX.
 */
export function normalizeLeadAddress(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");
}

/** Letters, digits, spaces, and , . - / # ' */
export const LEAD_ADDRESS_FORMAT_MESSAGE =
  "Address can only include letters, numbers, spaces, and , . - / # '.";

const LEAD_ADDRESS_FORMAT_PATTERN = /^[A-Za-z0-9 ,.\-/#']+$/;

export function isValidLeadAddressFormat(value) {
  const text = String(value || "").trim();
  if (!text) {
    return true;
  }
  return LEAD_ADDRESS_FORMAT_PATTERN.test(text.replace(/\s+/g, " "));
}

export function getLeadAddressFormatError(value, label = "Address") {
  if (isValidLeadAddressFormat(value)) {
    return "";
  }
  return `${label} can only include letters, numbers, spaces, and , . - / # '.`;
}

function branchAddressFieldKey(branchId) {
  return `branch.${branchId}.address`;
}

export function findDuplicateLeadAddresses(formData = {}) {
  const entries = [];
  const hqAddress = normalizeLeadAddress(formData.billingAddress);
  if (hqAddress) {
    entries.push({
      address: hqAddress,
      displayAddress: String(formData.billingAddress || "").trim(),
      label: "Head office",
      field: "billingAddress",
    });
  }

  const branches = formData.hasMultipleAddresses ? formData.additionalAddresses || [] : [];

  for (const [index, entry] of branches.entries()) {
    const address = normalizeLeadAddress(entry?.address);
    if (!address) {
      continue;
    }

    entries.push({
      address,
      displayAddress: String(entry?.address || "").trim(),
      label: String(entry?.label || "").trim() || `Branch ${index + 1}`,
      field: entry?.id ? branchAddressFieldKey(entry.id) : "additionalAddresses",
      index,
    });
  }

  const seen = new Map();
  for (const entry of entries) {
    const prior = seen.get(entry.address);
    if (prior) {
      const message = "Address must be unique across Head office and branches.";
      return {
        message: `Address is used by both ${prior.label} and ${entry.label}. Each branch needs a unique address.`,
        fields: {
          [prior.field]: message,
          [entry.field]: message,
        },
      };
    }
    seen.set(entry.address, entry);
  }

  return null;
}

export function collectLeadAddressFormatErrors(formData = {}) {
  const errors = {};
  const hqError = getLeadAddressFormatError(formData.billingAddress, "Head office address");
  if (hqError && String(formData.billingAddress || "").trim()) {
    errors.billingAddress = hqError;
  }

  const branches = formData.hasMultipleAddresses ? formData.additionalAddresses || [] : [];
  for (const [index, entry] of branches.entries()) {
    if (!String(entry?.address || "").trim()) {
      continue;
    }
    const branchError = getLeadAddressFormatError(
      entry.address,
      `Branch ${index + 1} address`,
    );
    if (branchError) {
      const key = entry?.id ? branchAddressFieldKey(entry.id) : `branch.${index}.address`;
      errors[key] = branchError;
    }
  }

  return Object.keys(errors).length ? errors : null;
}
