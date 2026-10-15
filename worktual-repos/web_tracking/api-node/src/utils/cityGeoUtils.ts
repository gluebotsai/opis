/** Normalize reverse-geocode / IP city labels (mirrors etl/ingest/city_normalize.py). */

const CITY_ALIASES: Record<string, string> = {
  "chennai corporation": "Chennai",
  "greater chennai corporation": "Chennai",
  chennai: "Chennai",
  bengaluru: "Bengaluru",
  bangalore: "Bengaluru",
  mumbai: "Mumbai",
  bombay: "Mumbai",
  delhi: "Delhi",
  "new delhi": "Delhi",
  kolkata: "Kolkata",
  calcutta: "Kolkata",
  hyderabad: "Hyderabad",
  pune: "Pune",
};

function cleanText(value: unknown): string | null {
  if (value == null) return null;
  const text = String(value).trim();
  return text || null;
}

export function normalizeCityName(value: unknown): string | null {
  const text = cleanText(value);
  if (!text) return null;
  const key = text.toLowerCase();
  if (CITY_ALIASES[key]) return CITY_ALIASES[key];
  if (/\bcorporation\b/i.test(text) && key.includes("chennai")) return "Chennai";
  const districtMatch = /\s+district\s*$/i.exec(text);
  if (districtMatch) {
    const base = text.slice(0, districtMatch.index).trim();
    if (base) return normalizeCityName(base) ?? base;
  }
  return text;
}

function adminFromStateDistrict(stateDistrict: unknown): string | null {
  const text = cleanText(stateDistrict);
  if (!text) return null;
  return normalizeCityName(text);
}

export function resolveDisplayCity(options: {
  primary?: unknown;
  locality?: unknown;
  stateDistrict?: unknown;
  ipCity?: unknown;
}): string | null {
  const primaryNorm = normalizeCityName(options.primary);
  const localityNorm = normalizeCityName(options.locality);
  const stateAdmin = adminFromStateDistrict(options.stateDistrict);
  const ipNorm = normalizeCityName(options.ipCity);

  if (primaryNorm && localityNorm && primaryNorm === localityNorm) {
    if (stateAdmin) return stateAdmin;
    if (ipNorm && ipNorm.toLowerCase() !== localityNorm.toLowerCase()) return ipNorm;
    return primaryNorm;
  }

  const metros = new Set(Object.values(CITY_ALIASES));

  if (primaryNorm) {
    if (ipNorm && primaryNorm.toLowerCase() !== ipNorm.toLowerCase() && metros.has(ipNorm)) {
      return ipNorm;
    }
    if (localityNorm && primaryNorm === localityNorm && stateAdmin) return stateAdmin;
    if (localityNorm && primaryNorm === localityNorm && ipNorm) return ipNorm;
    return primaryNorm;
  }

  if (stateAdmin) return stateAdmin;
  if (ipNorm) return ipNorm;
  if (localityNorm) return localityNorm;
  return null;
}

export function resolveCityForSession(
  sessionRow: Record<string, unknown> | null | undefined,
  geo: Record<string, unknown> | null,
): string {
  const sessionCity = sessionRow?.city;
  if (geo) {
    const isGps =
      geo.location_source === "gps" || geo.source === "gps" || Boolean(geo.gps);
    const ipGeo =
      geo.ip_geo && typeof geo.ip_geo === "object" && !Array.isArray(geo.ip_geo)
        ? (geo.ip_geo as Record<string, unknown>)
        : null;

    const resolved = resolveDisplayCity({
      primary: sessionCity ?? geo.city,
      locality: geo.locality,
      stateDistrict: geo.state_district,
      ipCity: isGps ? ipGeo?.city : undefined,
    });
    if (resolved) return resolved;
  }

  return normalizeCityName(sessionCity) ?? "Unknown";
}
