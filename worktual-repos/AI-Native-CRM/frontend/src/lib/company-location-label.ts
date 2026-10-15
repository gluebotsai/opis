/** Display geography, never a type label like "Headquarters". */

const GENERIC_LOCATION_LABELS = new Set([
  "headquarters",
  "hq",
  "head office",
  "headoffice",
  "corporate office",
  "main office",
  "registered office",
  "worldwide",
  "global",
  "remote",
  "multiple locations",
  "n/a",
  "na",
  "none",
  "unknown",
  "tbd",
  "address",
]);

export function isGenericLocationLabel(
  value: string | null | undefined,
): boolean {
  const lower = (value ?? "").trim().toLowerCase().replace(/\s+/g, " ");
  if (!lower) return true;
  if (GENERIC_LOCATION_LABELS.has(lower)) return true;
  if (/^(headquarters|hq|head office)\b/i.test(lower) && !lower.includes(",")) {
    return true;
  }
  return false;
}

export function displayCompanyLocationLabel(input: {
  name?: string | null;
  city?: string | null;
  address?: string | null;
}): string | null {
  const address = (input.address ?? "").trim();
  if (address && !isGenericLocationLabel(address)) return address;
  const city = (input.city ?? "").trim();
  if (city && !isGenericLocationLabel(city)) return city;
  const name = (input.name ?? "").trim();
  if (name && !isGenericLocationLabel(name)) return name;
  return null;
}
