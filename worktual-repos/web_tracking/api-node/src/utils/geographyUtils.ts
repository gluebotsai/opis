export const COUNTRY_NAMES: Record<string, string> = {
  US: "United States",
  GB: "United Kingdom",
  IN: "India",
  CA: "Canada",
  AU: "Australia",
  DE: "Germany",
  FR: "France",
  BR: "Brazil",
  MX: "Mexico",
  ES: "Spain",
  IT: "Italy",
  NL: "Netherlands",
  JP: "Japan",
  CN: "China",
  KR: "South Korea",
  SG: "Singapore",
  AE: "United Arab Emirates",
  SA: "Saudi Arabia",
  ZA: "South Africa",
  SE: "Sweden",
  NO: "Norway",
  DK: "Denmark",
  FI: "Finland",
  PL: "Poland",
  BE: "Belgium",
  CH: "Switzerland",
  AT: "Austria",
  IE: "Ireland",
  NZ: "New Zealand",
  PT: "Portugal",
  RU: "Russia",
  TR: "Turkey",
  ID: "Indonesia",
  MY: "Malaysia",
  PH: "Philippines",
  TH: "Thailand",
  VN: "Vietnam",
  PK: "Pakistan",
  BD: "Bangladesh",
  NG: "Nigeria",
  EG: "Egypt",
  AR: "Argentina",
  CL: "Chile",
  CO: "Colombia",
};

export function countryName(code: string | null | undefined): string {
  if (!code) return "Unknown";
  const upper = code.toUpperCase();
  if (upper === "UN" || upper === "UNKNOWN") return "Unknown";
  return COUNTRY_NAMES[upper] ?? upper;
}

export interface GeographySessionRow {
  session_id: string;
  visitor_id: string;
  country?: string | null;
  city?: string | null;
  region?: string | null;
}

function sharePercent(part: number, total: number): number {
  return total ? Math.round((part / total) * 10000) / 100 : 0;
}

export function aggregateGeography(rows: GeographySessionRow[]) {
  const countryStats: Record<
    string,
    { country_code: string; country: string; visitors: Set<string>; sessions: number }
  > = {};
  const cityStats: Record<
    string,
    { city: string; country_code: string; country: string; visitors: Set<string>; sessions: number }
  > = {};

  for (const row of rows) {
    const countryCode = (row.country ?? "UN").toUpperCase();
    const city = (row.city ?? "").trim() || "Unknown";
    const cityKey = `${city}|${countryCode}`;

    if (!countryStats[countryCode]) {
      countryStats[countryCode] = {
        country_code: countryCode,
        country: countryName(countryCode),
        visitors: new Set(),
        sessions: 0,
      };
    }
    countryStats[countryCode].visitors.add(row.visitor_id);
    countryStats[countryCode].sessions += 1;

    if (!cityStats[cityKey]) {
      cityStats[cityKey] = {
        city,
        country_code: countryCode,
        country: countryName(countryCode),
        visitors: new Set(),
        sessions: 0,
      };
    }
    cityStats[cityKey].visitors.add(row.visitor_id);
    cityStats[cityKey].sessions += 1;
  }

  const totalSessions = rows.length;

  const countriesRaw = Object.values(countryStats)
    .map((stats) => ({
      country_code: stats.country_code,
      country: stats.country,
      visitors: stats.visitors.size,
      sessions: stats.sessions,
      percentage: 0,
    }))
    .sort((a, b) => b.visitors - a.visitors);

  const activeCountries = countriesRaw.filter((item) => item.sessions > 0);
  const totalCountryVisitors = activeCountries.reduce((sum, item) => sum + item.visitors, 0);
  const countries = countriesRaw.map((item) => ({
    ...item,
    percentage: item.sessions > 0 ? sharePercent(item.visitors, totalCountryVisitors) : 0,
  }));

  const citiesRaw = Object.values(cityStats)
    .map((stats) => ({
      city: stats.city,
      country_code: stats.country_code,
      country: stats.country,
      visitors: stats.visitors.size,
      sessions: stats.sessions,
      percentage: 0,
    }))
    .sort((a, b) => b.visitors - a.visitors);

  const topCities = citiesRaw.slice(0, 10);
  const totalCityVisitors = topCities.reduce((sum, item) => sum + item.visitors, 0);
  const cities = topCities.map((item) => ({
    ...item,
    percentage: sharePercent(item.visitors, totalCityVisitors),
  }));

  const mapData = countries
    .filter((item) => item.country_code !== "UN")
    .map((item) => ({
      country: item.country_code.toLowerCase(),
      country_code: item.country_code,
      country_name: item.country,
      visitors: item.visitors,
      sessions: item.sessions,
    }));

  return {
    total_sessions: totalSessions,
    total_visitors: new Set(rows.map((r) => r.visitor_id)).size,
    map: mapData,
    countries: countries.slice(0, 10),
    cities,
  };
}
