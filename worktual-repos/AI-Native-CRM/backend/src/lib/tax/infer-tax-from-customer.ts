import { INDIA_STATES, type TaxCountry } from "@/lib/tax/global-tax";

/** Major city / alias → Indian state code (best-effort from CRM free-text). */
const INDIA_CITY_TO_STATE: Record<string, string> = {
  chennai: "TN",
  madurai: "TN",
  coimbatore: "TN",
  trichy: "TN",
  tiruchirappalli: "TN",
  bengaluru: "KA",
  bangalore: "KA",
  mysuru: "KA",
  mysore: "KA",
  mangalore: "KA",
  mangaluru: "KA",
  hubli: "KA",
  mumbai: "MH",
  pune: "MH",
  nagpur: "MH",
  nashik: "MH",
  thane: "MH",
  hyderabad: "TS",
  secunderabad: "TS",
  warangal: "TS",
  delhi: "DL",
  "new delhi": "DL",
  noida: "UP",
  gurgaon: "HR",
  gurugram: "HR",
  faridabad: "HR",
  kolkata: "WB",
  howrah: "WB",
  ahmedabad: "GJ",
  surat: "GJ",
  vadodara: "GJ",
  rajkot: "GJ",
  jaipur: "RJ",
  jodhpur: "RJ",
  udaipur: "RJ",
  lucknow: "UP",
  kanpur: "UP",
  varanasi: "UP",
  chandigarh: "CH",
  mohali: "PB",
  ludhiana: "PB",
  amritsar: "PB",
  bhopal: "MP",
  indore: "MP",
  patna: "BR",
  ranchi: "JH",
  bhubaneswar: "OD",
  cuttack: "OD",
  thiruvananthapuram: "KL",
  trivandrum: "KL",
  kochi: "KL",
  cochin: "KL",
  kozhikode: "KL",
  guwahati: "AS",
  shimla: "HP",
  dehradun: "UK",
  raipur: "CT",
  panaji: "GA",
  goa: "GA",
  puducherry: "PY",
  pondicherry: "PY",
  srinagar: "JK",
  jammu: "JK",
};

function normalizeText(value: string | null | undefined): string {
  return (value ?? "").trim().toLowerCase().replace(/\s+/g, " ");
}

export function inferTaxCountry(hints: {
  country?: string | null;
  currency?: string | null;
  domain?: string | null;
  addressText?: string | null;
}): TaxCountry | null {
  const country = normalizeText(hints.country);
  if (
    country === "in" ||
    country === "ind" ||
    country.includes("india") ||
    country.includes("bharat")
  ) {
    return "IN";
  }
  if (
    country === "uk" ||
    country === "gb" ||
    country.includes("united kingdom") ||
    country.includes("great britain") ||
    country.includes("england") ||
    country.includes("scotland") ||
    country.includes("wales") ||
    country.includes("northern ireland")
  ) {
    return "UK";
  }
  if (
    country === "us" ||
    country === "usa" ||
    country.includes("united states") ||
    country.includes("america")
  ) {
    return "US";
  }

  const currency = (hints.currency ?? "").trim().toUpperCase();
  if (currency === "INR") return "IN";
  if (currency === "GBP") return "UK";
  if (currency === "USD") return "US";

  const domain = normalizeText(hints.domain);
  if (domain.endsWith(".in") || domain.includes(".co.in")) return "IN";
  if (
    domain.endsWith(".uk") ||
    domain.includes(".co.uk") ||
    domain.endsWith(".gb")
  ) {
    return "UK";
  }
  if (domain.endsWith(".us")) return "US";

  const address = normalizeText(hints.addressText);
  if (
    address.includes("india") ||
    address.includes("tamil nadu") ||
    address.includes("karnataka") ||
    address.includes("maharashtra")
  ) {
    return "IN";
  }
  if (
    address.includes("united kingdom") ||
    address.includes(" london") ||
    address.endsWith(" uk") ||
    address.includes(", uk")
  ) {
    return "UK";
  }
  if (
    address.includes("united states") ||
    address.includes(" usa") ||
    /, [a-z]{2} \d{5}/.test(address)
  ) {
    return "US";
  }

  return null;
}

export function inferIndiaStateCode(
  ...parts: Array<string | null | undefined>
): string | null {
  const haystack = parts
    .map((p) => normalizeText(p))
    .filter(Boolean)
    .join(" | ");
  if (!haystack) return null;

  // Exact city match
  for (const [city, code] of Object.entries(INDIA_CITY_TO_STATE)) {
    if (
      haystack === city ||
      haystack.includes(` ${city} `) ||
      haystack.startsWith(`${city} `) ||
      haystack.endsWith(` ${city}`) ||
      haystack.includes(`| ${city} |`) ||
      haystack.includes(`, ${city}`) ||
      haystack.includes(`${city},`)
    ) {
      return code;
    }
  }

  // State label / code match (longest labels first)
  const byLabelLength = [...INDIA_STATES].sort(
    (a, b) => b.label.length - a.label.length,
  );
  for (const state of byLabelLength) {
    const label = normalizeText(state.label);
    if (haystack.includes(label)) return state.value;
    // Word-boundary-ish code match: "TN" as token
    const code = state.value.toLowerCase();
    if (
      haystack === code ||
      haystack.includes(` ${code} `) ||
      haystack.includes(`, ${code}`) ||
      haystack.endsWith(` ${code}`) ||
      haystack.includes(`| ${code} |`)
    ) {
      return state.value;
    }
  }

  return null;
}

export function defaultCurrencyForTaxCountry(country: TaxCountry): string {
  if (country === "IN") return "INR";
  if (country === "UK") return "GBP";
  return "USD";
}

export function buildBillingAddress(parts: Array<string | null | undefined>) {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const part of parts) {
    const trimmed = (part ?? "").trim();
    if (!trimmed) continue;
    const key = normalizeText(trimmed);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(trimmed);
  }
  return out.join(", ");
}
