export const EMAIL_VALIDATION_MESSAGE = "Enter a valid email address (example: name@company.com).";

export function isValidEmailAddress(value: any) {
  const email = String(value || "").trim();
  if (!email) {
    return false;
  }

  return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/i.test(email);
}

export function validateEmailAddress(value: any, label: any = "Email") {
  const email = String(value || "").trim();
  if (!email) {
    return "";
  }

  return isValidEmailAddress(email) ? "" : `${label} must be a valid email address.`;
}

/** Split a To/Cc/Bcc field on commas or semicolons. */
export function splitEmailList(value: any) {
  if (Array.isArray(value)) {
    return value
      .map((entry: any) => String(entry || "").trim())
      .filter(Boolean);
  }

  return String(value || "")
    .split(/[,;]/)
    .map((entry: any) => entry.trim())
    .filter(Boolean);
}

/** Extract bare address from `Name <email@x.com>` or return the trimmed entry. */
export function extractEmailAddress(entry: any) {
  const raw = String(entry || "").trim();
  if (!raw) {
    return "";
  }

  const angled = raw.match(/<([^>]+)>/);
  if (angled?.[1]) {
    return angled[1].trim();
  }

  return raw;
}

/**
 * Validate a recipient list field.
 * @param {string|string[]} value
 * @param {{ required?: boolean, label?: string }} [options]
 */
export function validateRecipientList(value: any, { required = false, label = "To" }: any = {}) {
  const entries = splitEmailList(value);

  if (!entries.length) {
    if (required) {
      return {
        valid: false,
        message: `Please enter at least one recipient in ${label}.`,
        entries: [],
      };
    }
    return { valid: true, message: "", entries: [] };
  }

  const invalid = entries.filter((entry: any) => !isValidEmailAddress(extractEmailAddress(entry)));
  if (invalid.length) {
    return {
      valid: false,
      message: `Invalid ${label} address${invalid.length > 1 ? "es" : ""}: ${invalid.join(", ")}`,
      entries,
    };
  }

  return { valid: true, message: "", entries };
}

/**
 * Validate mail To (required) and Cc/Bcc (when present).
 * @returns {{ valid: boolean, message: string, to: string[], cc: string[], bcc: string[] }}
 */
export function validateMailRecipients({ to, cc, bcc }: any = {}) {
  const toCheck = validateRecipientList(to, { required: true, label: "To" });
  if (!toCheck.valid) {
    return { valid: false, message: toCheck.message, to: [], cc: [], bcc: [] };
  }

  const ccCheck = validateRecipientList(cc, { required: false, label: "Cc" });
  if (!ccCheck.valid) {
    return { valid: false, message: ccCheck.message, to: toCheck.entries, cc: [], bcc: [] };
  }

  const bccCheck = validateRecipientList(bcc, { required: false, label: "Bcc" });
  if (!bccCheck.valid) {
    return {
      valid: false,
      message: bccCheck.message,
      to: toCheck.entries,
      cc: ccCheck.entries,
      bcc: [],
    };
  }

  return {
    valid: true,
    message: "",
    to: toCheck.entries,
    cc: ccCheck.entries,
    bcc: bccCheck.entries,
  };
}
