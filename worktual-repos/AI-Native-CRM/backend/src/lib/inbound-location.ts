/**
 * Location for inbound leads (email, call, marketing, social/CCaaS).
 * Prefer explicit payload fields; otherwise country from an E.164 phone.
 * Never invent a city.
 */

export type InboundLocation = {
  city: string | null;
  country: string | null;
  addressLine: string | null;
};

const COUNTRY_BY_CALLING_CODE: Array<[string, string]> = [
  ["971", "United Arab Emirates"],
  ["966", "Saudi Arabia"],
  ["965", "Kuwait"],
  ["974", "Qatar"],
  ["973", "Bahrain"],
  ["968", "Oman"],
  ["880", "Bangladesh"],
  ["977", "Nepal"],
  ["960", "Maldives"],
  ["94", "Sri Lanka"],
  ["92", "Pakistan"],
  ["91", "India"],
  ["86", "China"],
  ["84", "Vietnam"],
  ["82", "South Korea"],
  ["81", "Japan"],
  ["66", "Thailand"],
  ["65", "Singapore"],
  ["64", "New Zealand"],
  ["63", "Philippines"],
  ["62", "Indonesia"],
  ["61", "Australia"],
  ["60", "Malaysia"],
  ["55", "Brazil"],
  ["49", "Germany"],
  ["44", "United Kingdom"],
  ["39", "Italy"],
  ["34", "Spain"],
  ["33", "France"],
  ["27", "South Africa"],
  ["20", "Egypt"],
  ["1", "United States"],
];

const COUNTRY_ALIASES: Record<string, string> = {
  in: "India",
  india: "India",
  us: "United States",
  usa: "United States",
  "united states": "United States",
  "united states of america": "United States",
  uk: "United Kingdom",
  gb: "United Kingdom",
  "united kingdom": "United Kingdom",
  ae: "United Arab Emirates",
  uae: "United Arab Emirates",
  sg: "Singapore",
  singapore: "Singapore",
  my: "Malaysia",
  malaysia: "Malaysia",
  au: "Australia",
  australia: "Australia",
};

function trimStr(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const text = value.trim();
  return text || null;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function canonicalCountry(raw: string | null): string | null {
  if (!raw) return null;
  const key = raw.trim().toLowerCase();
  return COUNTRY_ALIASES[key] ?? (raw.trim() || null);
}

/** Last comma segment that is a known country, rest is city/region. */
export function splitGeography(raw: string | null | undefined): {
  city: string | null;
  country: string | null;
} {
  const text = raw?.trim() || "";
  if (!text) return { city: null, country: null };
  const asCountry = COUNTRY_ALIASES[text.toLowerCase()];
  if (asCountry) return { city: null, country: asCountry };
  const parts = text.split(",").map((part) => part.trim()).filter(Boolean);
  if (parts.length >= 2) {
    const last = parts[parts.length - 1]!;
    const aliased = COUNTRY_ALIASES[last.toLowerCase()];
    if (aliased) {
      return {
        city: parts.slice(0, -1).join(", ").trim() || null,
        country: aliased,
      };
    }
  }
  return { city: text, country: null };
}

export function countryFromPhone(phone: string | null | undefined): string | null {
  const digits = String(phone ?? "").replace(/\D/g, "");
  if (digits.length < 8) return null;
  const e164 = String(phone ?? "").trim().startsWith("+")
    ? digits
    : digits.length === 10
      ? null
      : digits;
  const haystack = e164 ?? digits;
  for (const [code, country] of COUNTRY_BY_CALLING_CODE) {
    if (haystack.startsWith(code) && haystack.length - code.length >= 7) {
      return country;
    }
  }
  return null;
}

function pickField(
  bag: Record<string, unknown> | null,
  keys: string[],
): string | null {
  if (!bag) return null;
  for (const key of keys) {
    const value = trimStr(bag[key]);
    if (value) return value;
  }
  return null;
}

/**
 * Resolve city / country / address from a channel payload, then phone.
 */
export function locationFromInbound(
  input: Record<string, unknown> | null | undefined,
  phone?: string | null,
): InboundLocation {
  const bag = asRecord(input) ?? {};
  const nested =
    asRecord(bag.location) ??
    asRecord(bag.geo) ??
    asRecord(bag.geography) ??
    asRecord(bag.address) ??
    null;

  const explicitCity =
    pickField(bag, ["city", "town"]) ??
    pickField(nested, ["city", "town", "locality"]);
  const explicitCountry =
    canonicalCountry(
      pickField(bag, ["country", "countryName", "countryCode"]) ??
        pickField(nested, ["country", "countryName", "countryCode"]),
    );
  const region =
    pickField(bag, ["region", "state", "province"]) ??
    pickField(nested, ["region", "state", "province"]);
  const addressLine =
    pickField(bag, ["addressLine", "address", "street"]) ??
    pickField(nested, ["addressLine", "line1", "street"]);
  const geography =
    pickField(bag, ["location", "geography", "geo"]) ??
    (typeof bag.location === "string" ? trimStr(bag.location) : null);

  let city = explicitCity;
  let country = explicitCountry;
  if ((!city || !country) && geography && typeof input?.location !== "object") {
    const split = splitGeography(geography);
    city = city ?? split.city;
    country = country ?? split.country;
  }
  if (city && !country) {
    const split = splitGeography(city);
    if (split.country) {
      city = split.city ?? city;
      country = split.country;
    }
  }
  if (region && city && !city.toLowerCase().includes(region.toLowerCase())) {
    city = `${city}, ${region}`;
  } else if (!city && region) {
    city = region;
  }
  country = country ?? countryFromPhone(phone ?? trimStr(bag.phone));

  return {
    city: city?.slice(0, 120) ?? null,
    country: country?.slice(0, 80) ?? null,
    addressLine: addressLine?.slice(0, 240) ?? null,
  };
}
