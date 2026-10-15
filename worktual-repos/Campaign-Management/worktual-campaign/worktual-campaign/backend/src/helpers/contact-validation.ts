/**
 * Contact email + phone validation.
 * Phone must include country calling code; national length is validated per country.
 */

/** Keep in sync with agents/validation.py and frontend/lib/contact-validation.ts */
const EMAIL_RE =
  /^[a-zA-Z0-9](?:[a-zA-Z0-9._%+-]{0,62}[a-zA-Z0-9])?@[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)*\.[a-zA-Z]{2,24}$/;

/** ITU calling code → expected national significant number length(s). */
const NATIONAL_LENGTH: Record<string, number | [number, number]> = {
  "1": 10, // US / CA
  "7": 10, // RU / KZ
  "20": 10, // EG
  "27": 9, // ZA
  "30": 10, // GR
  "31": 9, // NL
  "32": 9, // BE
  "33": 9, // FR
  "34": 9, // ES
  "39": [9, 10], // IT
  "44": 10, // GB
  "49": [10, 11], // DE
  "52": 10, // MX
  "55": [10, 11], // BR
  "61": 9, // AU
  "62": [9, 12], // ID
  "63": 10, // PH
  "64": [8, 10], // NZ
  "65": 8, // SG
  "66": 9, // TH
  "81": [10, 11], // JP
  "82": [9, 10], // KR
  "84": [9, 10], // VN
  "86": 11, // CN
  "90": 10, // TR
  "91": 10, // IN
  "92": 10, // PK
  "93": 9, // AF
  "94": 9, // LK
  "95": [8, 10], // MM
  "98": 10, // IR
  "212": 9, // MA
  "213": 9, // DZ
  "216": 8, // TN
  "234": [10, 11], // NG
  "254": 9, // KE
  "255": 9, // TZ
  "256": 9, // UG
  "351": 9, // PT
  "352": 9, // LU
  "353": 9, // IE
  "358": [9, 10], // FI
  "360": 9, // HU? wait 36
  "36": 9, // HU
  "370": 8, // LT
  "371": 8, // LV
  "372": 7, // EE? often 7-8
  "380": 9, // UA
  "385": 9, // HR
  "420": 9, // CZ
  "421": 9, // SK
  "48": 9, // PL
  "46": [9, 10], // SE
  "47": 8, // NO
  "45": 8, // DK
  "41": 9, // CH
  "43": [10, 11], // AT
  "971": 9, // AE
  "966": 9, // SA
  "965": 8, // KW
  "974": 8, // QA
  "973": 8, // BH
  "968": 8, // OM
  "960": 7, // MV
  "880": 10, // BD
  "977": 10, // NP
  "975": 8, // BT
  "852": 8, // HK
  "853": 8, // MO
  "886": 9, // TW
  "60": [9, 10], // MY
};

/** Longest codes first for greedy match. */
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

export type PhoneParseOk = {
  ok: true;
  e164: string;
  countryCode: string;
  nationalNumber: string;
};

export type PhoneParseErr = {
  ok: false;
  message: string;
};

export type PhoneParseResult = PhoneParseOk | PhoneParseErr;

/**
 * Collapse duplicated calling codes (e.g. 91 + 919346765884 → 919346765884).
 * Runs until stable so triple-prefix mistakes also clear.
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
      // Strip when remainder is itself a plausible CC + national number.
      if (matchCallingCode(candidate)) {
        digits = candidate;
        stripped = true;
        break;
      }
      // India / common: CC+CC+national where national length matches after one CC.
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

/**
 * Require country code (+CC or CC). Validate national length for that country.
 * Returns normalized E.164-style string (+CC + national digits).
 */
export function parseAndValidatePhone(raw: string | null | undefined): PhoneParseResult {
  const trimmed = (raw || "").trim();
  if (!trimmed) {
    return {
      ok: false,
      message: "Phone number with country code is required.",
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

export function validateContactIdentity(input: {
  email?: string | null;
  phone?: string | null;
}):
  | { ok: true; email: string | null; phone: string | null }
  | { ok: false; message: string } {
  const emailRaw = (input.email || "").trim().toLowerCase();
  const phoneRaw = (input.phone || "").trim();

  let email: string | null = null;
  if (emailRaw) {
    if (!isValidEmailFormat(emailRaw)) {
      return { ok: false, message: "Enter a valid email address." };
    }
    email = emailRaw;
  }

  let phone: string | null = null;
  if (phoneRaw) {
    const parsed = parseAndValidatePhone(phoneRaw);
    if (!parsed.ok) {
      return { ok: false, message: parsed.message };
    }
    phone = parsed.e164;
  }

  if (!phone) {
    return {
      ok: false,
      message: "Phone number with country code is required (e.g. +91 9876543210).",
    };
  }

  return { ok: true, email, phone };
}

/** Integration / app-push register: at least one of email or phone. */
export function validateContactIdentityFlexible(input: {
  email?: string | null;
  phone?: string | null;
}):
  | { ok: true; email: string | null; phone: string | null }
  | { ok: false; message: string } {
  const emailRaw = (input.email || "").trim().toLowerCase();
  const phoneRaw = (input.phone || "").trim();

  let email: string | null = null;
  if (emailRaw) {
    if (!isValidEmailFormat(emailRaw)) {
      return { ok: false, message: "Enter a valid email address." };
    }
    email = emailRaw;
  }

  let phone: string | null = null;
  if (phoneRaw) {
    const parsed = parseAndValidatePhone(phoneRaw);
    if (!parsed.ok) {
      return { ok: false, message: parsed.message };
    }
    phone = parsed.e164;
  }

  if (!email && !phone) {
    return {
      ok: false,
      message: "Provide email and/or phone to identify the contact.",
    };
  }

  return { ok: true, email, phone };
}

/** Normalize phones for equality (ignore spaces/dashes; compare E.164 digits). */
export function phonesMatch(
  a: string | null | undefined,
  b: string | null | undefined,
): boolean {
  const pa = parseAndValidatePhone(a);
  const pb = parseAndValidatePhone(b);
  if (pa.ok && pb.ok) return pa.e164 === pb.e164;
  return digitsOnly(a || "") === digitsOnly(b || "") && Boolean(digitsOnly(a || ""));
}

export function emailsMatch(
  a: string | null | undefined,
  b: string | null | undefined,
): boolean {
  return (a || "").trim().toLowerCase() === (b || "").trim().toLowerCase();
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

/** {{first_name}} greeting: empty / "there" stay "there"; otherwise title-cased. */
export function greetingFirstName(raw: string | null | undefined): string {
  const t = String(raw ?? "").trim();
  if (!t || t.toLowerCase() === "there") return "there";
  return titleCasePersonName(t);
}
