/**
 * Frontend copy of contact email/phone validation (keep in sync with backend helper).
 */

/** Keep in sync with backend helper and agents/validation.py */
const EMAIL_RE =
  /^[a-zA-Z0-9](?:[a-zA-Z0-9._%+-]{0,62}[a-zA-Z0-9])?@[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)*\.[a-zA-Z]{2,24}$/;

const NATIONAL_LENGTH: Record<string, number | [number, number]> = {
  "1": 10,
  "7": 10,
  "20": 10,
  "27": 9,
  "30": 10,
  "31": 9,
  "32": 9,
  "33": 9,
  "34": 9,
  "36": 9,
  "39": [9, 10],
  "41": 9,
  "43": [10, 11],
  "44": 10,
  "45": 8,
  "46": [9, 10],
  "47": 8,
  "48": 9,
  "49": [10, 11],
  "52": 10,
  "55": [10, 11],
  "60": [9, 10],
  "61": 9,
  "62": [9, 12],
  "63": 10,
  "64": [8, 10],
  "65": 8,
  "66": 9,
  "81": [10, 11],
  "82": [9, 10],
  "84": [9, 10],
  "86": 11,
  "90": 10,
  "91": 10,
  "92": 10,
  "93": 9,
  "94": 9,
  "95": [8, 10],
  "98": 10,
  "212": 9,
  "213": 9,
  "216": 8,
  "234": [10, 11],
  "254": 9,
  "255": 9,
  "256": 9,
  "351": 9,
  "352": 9,
  "353": 9,
  "358": [9, 10],
  "370": 8,
  "371": 8,
  "372": 7,
  "380": 9,
  "385": 9,
  "420": 9,
  "421": 9,
  "852": 8,
  "853": 8,
  "880": 10,
  "886": 9,
  "960": 7,
  "965": 8,
  "966": 9,
  "968": 8,
  "971": 9,
  "973": 8,
  "974": 8,
  "975": 8,
  "977": 10,
};

const CALLING_CODES = Object.keys(NATIONAL_LENGTH).sort(
  (a, b) => b.length - a.length,
);

export function isValidEmailFormat(email: string): boolean {
  const v = email.trim();
  if (!v || v.length > 254 || v.includes("..")) return false;
  return EMAIL_RE.test(v);
}

function digitsOnly(value: string): string {
  return value.replace(/\D/g, "");
}

/**
 * Collapse duplicated calling codes (e.g. 91 + 919346765884 → 919346765884).
 */
export function collapseDoubledCallingCode(rawDigits: string): string {
  let digits = digitsOnly(rawDigits);
  if (digits.startsWith("00")) digits = digits.slice(2);

  for (let guard = 0; guard < 4; guard += 1) {
    let stripped = false;
    for (const code of CALLING_CODES) {
      const doubled = code + code;
      if (!digits.startsWith(doubled)) continue;
      const candidate = digits.slice(code.length);
      if (matchCallingCode(candidate)) {
        digits = candidate;
        stripped = true;
        break;
      }
      const national = candidate.slice(code.length);
      const expected = NATIONAL_LENGTH[code];
      const lenOk = Array.isArray(expected)
        ? national.length >= expected[0] && national.length <= expected[1]
        : national.length === expected;
      if (candidate.startsWith(code) && lenOk) {
        digits = candidate;
        stripped = true;
        break;
      }
    }
    if (!stripped) break;
  }
  return digits;
}

function matchCallingCode(
  digits: string,
): { countryCode: string; national: string } | null {
  for (const code of CALLING_CODES) {
    if (!digits.startsWith(code) || digits.length <= code.length) continue;
    const rest = digits.slice(code.length);
    const expected = NATIONAL_LENGTH[code];
    const lenOk = Array.isArray(expected)
      ? rest.length >= expected[0] && rest.length <= expected[1]
      : rest.length === expected;
    if (!lenOk) continue;
    return { countryCode: code, national: rest };
  }
  return null;
}

export type PhoneParseResult =
  | { ok: true; e164: string; countryCode: string; nationalNumber: string }
  | { ok: false; message: string };

export function parseAndValidatePhone(
  raw: string | null | undefined,
): PhoneParseResult {
  const trimmed = (raw || "").trim();
  if (!trimmed) {
    return {
      ok: false,
      message:
        "No phone provided. Use email instead, or enter a phone with country code (e.g. +91 9876543210).",
    };
  }

  const hasPlus = trimmed.startsWith("+");
  let digits = digitsOnly(trimmed);
  if (!digits) {
    return {
      ok: false,
      message: "Enter a phone number with country code (e.g. +91 9876543210).",
    };
  }

  digits = collapseDoubledCallingCode(digits);

  const matched = matchCallingCode(digits);
  if (!matched) {
    return {
      ok: false,
      message: hasPlus
        ? "Include a valid country code and the correct number of digits for that country (e.g. +91 9876543210)."
        : "Include a country code (e.g. +91 9876543210 or 919876543210).",
    };
  }

  return {
    ok: true,
    e164: `+${matched.countryCode}${matched.national}`,
    countryCode: matched.countryCode,
    nationalNumber: matched.national,
  };
}

export function validateContactEmailPhone(input: {
  email?: string;
  phone?: string;
}):
  | { ok: true; email: string | null; phone: string | null }
  | { ok: false; message: string; field?: "email" | "phone" } {
  const emailRaw = (input.email || "").trim().toLowerCase();
  const phoneRaw = (input.phone || "").trim();

  let email: string | null = null;
  if (emailRaw) {
    if (!isValidEmailFormat(emailRaw)) {
      return { ok: false, message: "Enter a valid email address.", field: "email" };
    }
    email = emailRaw;
  }

  let phone: string | null = null;
  if (phoneRaw) {
    const parsed = parseAndValidatePhone(phoneRaw);
    if (!parsed.ok) {
      return { ok: false, message: parsed.message, field: "phone" };
    }
    phone = parsed.e164;
  }

  if (!phone) {
    return {
      ok: false,
      message: "Phone number with country code is required (e.g. +91 9876543210).",
      field: "phone",
    };
  }

  return { ok: true, email, phone };
}

/**
 * Title-case a person name for storage and greetings.
 * aravindh → Aravindh, jean-paul → Jean-Paul, o'brien → O'Brien.
 */
export function titleCasePersonName(raw: string | null | undefined): string {
  const t = String(raw ?? "").trim();
  if (!t) return "";
  return t
    .split(/([\s-]+)/)
    .map((part) => {
      if (!part || /^[\s-]+$/.test(part)) return part;
      return part
        .split(/(')/)
        .map((seg) => {
          if (!seg || seg === "'") return seg;
          const chars = Array.from(seg);
          const head = chars[0] ?? "";
          const rest = chars.slice(1).join("");
          return (
            head.toLocaleUpperCase("en-US") + rest.toLocaleLowerCase("en-US")
          );
        })
        .join("");
    })
    .join("");
}
