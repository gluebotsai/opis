import { getCountries, getCountryCallingCode, type CountryCode } from "libphonenumber-js";

export const DEFAULT_PHONE_COUNTRY: CountryCode = "IN";

/** Shared calling codes: keep a stable country when a stored number is split back open. */
const PREFERRED_ISO: Partial<Record<string, CountryCode>> = {
  "1": "US",
  "7": "RU",
  "39": "IT",
  "44": "GB",
  "47": "NO",
  "61": "AU",
  "212": "MA",
  "262": "RE",
  "290": "SH",
  "358": "FI",
  "590": "GP",
  "599": "CW",
};

export type PhoneCountry = {
  iso: CountryCode;
  name: string;
  dial: string;
  code: string;
};

const regionNames = new Intl.DisplayNames(["en"], { type: "region" });

export const PHONE_COUNTRIES: PhoneCountry[] = getCountries()
  .map((iso) => {
    const code = getCountryCallingCode(iso);
    return {
      iso,
      name: regionNames.of(iso) ?? iso,
      dial: `+${code}`,
      code,
    };
  })
  .sort((left, right) => left.name.localeCompare(right.name) || left.dial.localeCompare(right.dial));

const byIso = new Map(PHONE_COUNTRIES.map((country) => [country.iso, country]));

const codeToIsos = new Map<string, CountryCode[]>();
for (const country of PHONE_COUNTRIES) {
  const list = codeToIsos.get(country.code) ?? [];
  list.push(country.iso);
  codeToIsos.set(country.code, list);
}

const callingCodesLongestFirst = [...codeToIsos.keys()].sort(
  (left, right) => right.length - left.length || left.localeCompare(right),
);

export function phoneCountryByIso(iso: string): PhoneCountry {
  return byIso.get(iso as CountryCode) ?? byIso.get(DEFAULT_PHONE_COUNTRY)!;
}

export function phoneDigits(value: string): string {
  const trimmed = value.trim();
  const digits = trimmed.replace(/\D/g, "");
  return trimmed.startsWith("00") ? digits.slice(2) : digits;
}

function isoForCallingCode(code: string): CountryCode {
  const preferred = PREFERRED_ISO[code];
  const options = codeToIsos.get(code) ?? [];
  if (preferred && options.includes(preferred)) return preferred;
  return options[0] ?? DEFAULT_PHONE_COUNTRY;
}

/** Longest calling-code prefix with a national number of at least 4 digits. */
export function matchCallingCode(digits: string): { iso: CountryCode; code: string } | null {
  if (!digits || digits.length > 15) return null;
  for (const code of callingCodesLongestFirst) {
    if (!digits.startsWith(code)) continue;
    const national = digits.slice(code.length).replace(/^0+/, "");
    if (national.length < 4) continue;
    return { iso: isoForCallingCode(code), code };
  }
  return null;
}

export type SplitPhone = {
  iso: CountryCode;
  national: string;
  matched: boolean;
};

export function splitPhoneNumber(
  value: string,
  fallbackIso: CountryCode = DEFAULT_PHONE_COUNTRY,
): SplitPhone {
  const digits = phoneDigits(value);
  const match = matchCallingCode(digits);
  if (!match) {
    return { iso: fallbackIso, national: digits.replace(/^0+/, ""), matched: false };
  }
  return {
    iso: match.iso,
    national: digits.slice(match.code.length).replace(/^0+/, ""),
    matched: true,
  };
}

/** National digits to show beside the selected country. */
export function nationalFromStored(stored: string, iso: string): string {
  const digits = phoneDigits(stored);
  if (!digits) return "";
  const code = phoneCountryByIso(iso).code;
  if (digits.startsWith(code)) return digits.slice(code.length);
  return digits.replace(/^0+/, "");
}

/**
 * Store country calling code + national digits, with no trunk prefix and no doubled code.
 * `+` or `00` input can switch the country. A bare national number uses `iso`.
 */
export function phoneFromNationalInput(
  iso: string,
  nationalRaw: string,
): { iso: CountryCode; stored: string } {
  const selected = phoneCountryByIso(iso);
  const trimmed = nationalRaw.trim();
  let digits = phoneDigits(trimmed);
  if (!digits) return { iso: selected.iso, stored: "" };

  const explicitIntl = trimmed.startsWith("+") || trimmed.startsWith("00");
  if (explicitIntl) {
    const match = matchCallingCode(digits);
    if (match) {
      const national = digits.slice(match.code.length).replace(/^0+/, "");
      return { iso: match.iso, stored: national ? `${match.code}${national}` : "" };
    }
  }

  digits = digits.replace(/^0+/, "");
  if (!digits) return { iso: selected.iso, stored: "" };

  if (digits.startsWith(selected.code) && digits.length - selected.code.length >= 4) {
    return { iso: selected.iso, stored: digits };
  }

  // A long number that already begins with some other calling code was pasted in full.
  // Shorter national numbers are prefixed with the selected code (416... must stay Canada, not Switzerland).
  if (digits.length > 10) {
    const other = matchCallingCode(digits);
    if (other && other.code !== selected.code) {
      const national = digits.slice(other.code.length).replace(/^0+/, "");
      return { iso: other.iso, stored: national ? `${other.code}${national}` : "" };
    }
  }

  return { iso: selected.iso, stored: `${selected.code}${digits}` };
}
