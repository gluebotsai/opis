/** 4 capital letters + 12–20 digits → total length 16–24. */
export const UTR_MIN_LENGTH = 16;
export const UTR_MAX_LENGTH = 24;
const UTR_PATTERN = /^[A-Z]{4}[0-9]{12,20}$/;

/** Trim before validate / submit. */
export function normalizeUtrInput(rawValue: unknown) {
  return String(rawValue ?? "").trim();
}

/** Strip non-alphanumeric and force uppercase. */
export function sanitizeUtrInput(rawValue: unknown) {
  return String(rawValue ?? "")
    .replace(/[^A-Za-z0-9]/g, "")
    .toUpperCase();
}

export function validateUtr(rawValue: unknown) {
  const value = sanitizeUtrInput(normalizeUtrInput(rawValue));
  if (!value) {
    return {
      ok: false as const,
      value,
      error: "Enter a UTR or bank reference.",
    };
  }
  if (!UTR_PATTERN.test(value)) {
    return {
      ok: false as const,
      value,
      error: "UTR must be 4 capital letters followed by 12–20 digits.",
    };
  }
  return { ok: true as const, value, error: "" };
}

export function assertValidUtr(rawValue: unknown, label = "UTR or bank reference") {
  const result = validateUtr(rawValue);
  if (!result.ok) {
    throw new Error(result.error || `Invalid ${label}.`);
  }
  return result.value;
}
