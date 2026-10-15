/** 4 capital letters + 12–20 digits → total length 16–24. */
export const UTR_MIN_LENGTH = 16;
export const UTR_MAX_LENGTH = 24;
const UTR_PATTERN = /^[A-Z]{4}[0-9]{12,20}$/;

/** Trim before validate / submit. */
export function normalizeUtrInput(rawValue) {
  return String(rawValue ?? "").trim();
}

/** Strip non-alphanumeric and force uppercase while typing. */
export function sanitizeUtrInput(rawValue) {
  return String(rawValue ?? "")
    .replace(/[^A-Za-z0-9]/g, "")
    .toUpperCase();
}

export function validateUtr(rawValue) {
  const value = sanitizeUtrInput(normalizeUtrInput(rawValue));
  if (!value) {
    return {
      ok: false,
      value,
      error: "Enter a UTR or bank reference.",
    };
  }
  if (!UTR_PATTERN.test(value)) {
    return {
      ok: false,
      value,
      error: "UTR must be 4 capital letters followed by 12–20 digits.",
    };
  }
  return { ok: true, value, error: "" };
}
