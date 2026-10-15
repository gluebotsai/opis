/**
 * Client-side mirror of server unique work-email rule for onboarding UX.
 */
export function normalizeWorkEmail(email) {
  return String(email || "")
    .trim()
    .toLowerCase();
}

function branchWorkEmailFieldKey(branchId) {
  return `branch.${branchId}.workEmail`;
}

export function findDuplicateLeadWorkEmails(formData = {}) {
  const entries = [];
  const hqEmail = normalizeWorkEmail(formData.workEmail);
  if (hqEmail) {
    entries.push({ email: hqEmail, label: "Head office", field: "workEmail" });
  }

  const branches = formData.hasMultipleAddresses
    ? formData.additionalAddresses || []
    : [];

  for (const [index, entry] of branches.entries()) {
    if (!String(entry?.address || "").trim() && !normalizeWorkEmail(entry?.workEmail)) {
      continue;
    }
    const email = normalizeWorkEmail(entry?.workEmail);
    if (!email) {
      continue;
    }
    entries.push({
      email,
      label: String(entry?.label || "").trim() || `Branch ${index + 1}`,
      field: entry?.id ? branchWorkEmailFieldKey(entry.id) : "additionalAddresses",
      index,
    });
  }

  const seen = new Map();
  for (const entry of entries) {
    const prior = seen.get(entry.email);
    if (prior) {
      const message = `Work email must be unique across Head office and branches.`;
      return {
        message: `Work email ${entry.email} is used by both ${prior.label} and ${entry.label}. Each branch needs a unique work email.`,
        fields: {
          [prior.field]: message,
          [entry.field]: message,
        },
      };
    }
    seen.set(entry.email, entry);
  }

  return null;
}
