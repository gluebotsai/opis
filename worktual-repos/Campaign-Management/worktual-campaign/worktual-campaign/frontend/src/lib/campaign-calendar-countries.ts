/**
 * Country packs for Campaign Calendar — weekends, timezone, and holidays.
 * Holidays are detailed for a few markets; others use timezone + weekend only.
 */

export type CalendarCountryId = string;

export type CalendarHoliday = {
  /** YYYY-MM-DD */
  date: string;
  name: string;
};

export type CalendarCountry = {
  id: CalendarCountryId;
  name: string;
  /** IANA timezone used to place campaigns on local dates */
  timeZone: string;
  /** JS getDay(): 0=Sun … 6=Sat — weekend days for this country */
  weekendDays: number[];
  flagEmoji: string;
  holidays: CalendarHoliday[];
};

const SAT_SUN = [0, 6] as const;
const FRI_SAT = [5, 6] as const;

/** Fri–Sat weekend (common in parts of MENA / Gulf). */
const FRI_SAT_ISO = new Set([
  "AE",
  "SA",
  "QA",
  "KW",
  "BH",
  "OM",
  "EG",
  "JO",
  "IQ",
  "LY",
  "DZ",
  "YE",
  "PS",
  "IR",
  "IL",
  "AF",
  "SD",
]);

function flagEmoji(iso: string): string {
  const cc = iso.toUpperCase();
  if (!/^[A-Z]{2}$/.test(cc)) return "";
  return String.fromCodePoint(
    ...[...cc].map((c) => 0x1f1e6 - 65 + c.charCodeAt(0)),
  );
}

/** Shared holiday helpers spanning 2025–2027 for the demo window. */
const IN_HOLIDAYS: CalendarHoliday[] = [
  { date: "2025-01-26", name: "Republic Day" },
  { date: "2025-03-14", name: "Holi" },
  { date: "2025-08-15", name: "Independence Day" },
  { date: "2025-10-02", name: "Gandhi Jayanti" },
  { date: "2025-10-21", name: "Diwali" },
  { date: "2025-12-25", name: "Christmas" },
  { date: "2026-01-26", name: "Republic Day" },
  { date: "2026-03-03", name: "Holi" },
  { date: "2026-08-15", name: "Independence Day" },
  { date: "2026-10-02", name: "Gandhi Jayanti" },
  { date: "2026-11-08", name: "Diwali" },
  { date: "2026-12-25", name: "Christmas" },
  { date: "2027-01-26", name: "Republic Day" },
  { date: "2027-03-22", name: "Holi" },
  { date: "2027-08-15", name: "Independence Day" },
  { date: "2027-10-02", name: "Gandhi Jayanti" },
  { date: "2027-10-29", name: "Diwali" },
  { date: "2027-12-25", name: "Christmas" },
];

const US_HOLIDAYS: CalendarHoliday[] = [
  { date: "2025-01-01", name: "New Year's Day" },
  { date: "2025-01-20", name: "Martin Luther King Jr. Day" },
  { date: "2025-07-04", name: "Independence Day" },
  { date: "2025-11-27", name: "Thanksgiving" },
  { date: "2025-12-25", name: "Christmas" },
  { date: "2026-01-01", name: "New Year's Day" },
  { date: "2026-01-19", name: "Martin Luther King Jr. Day" },
  { date: "2026-07-04", name: "Independence Day" },
  { date: "2026-11-26", name: "Thanksgiving" },
  { date: "2026-12-25", name: "Christmas" },
  { date: "2027-01-01", name: "New Year's Day" },
  { date: "2027-01-18", name: "Martin Luther King Jr. Day" },
  { date: "2027-07-04", name: "Independence Day" },
  { date: "2027-11-25", name: "Thanksgiving" },
  { date: "2027-12-25", name: "Christmas" },
];

const GB_HOLIDAYS: CalendarHoliday[] = [
  { date: "2025-01-01", name: "New Year's Day" },
  { date: "2025-04-18", name: "Good Friday" },
  { date: "2025-04-21", name: "Easter Monday" },
  { date: "2025-05-05", name: "Early May Bank Holiday" },
  { date: "2025-08-25", name: "Summer Bank Holiday" },
  { date: "2025-12-25", name: "Christmas Day" },
  { date: "2025-12-26", name: "Boxing Day" },
  { date: "2026-01-01", name: "New Year's Day" },
  { date: "2026-04-03", name: "Good Friday" },
  { date: "2026-04-06", name: "Easter Monday" },
  { date: "2026-05-04", name: "Early May Bank Holiday" },
  { date: "2026-08-31", name: "Summer Bank Holiday" },
  { date: "2026-12-25", name: "Christmas Day" },
  { date: "2026-12-28", name: "Boxing Day (substitute)" },
  { date: "2027-01-01", name: "New Year's Day" },
  { date: "2027-03-26", name: "Good Friday" },
  { date: "2027-03-29", name: "Easter Monday" },
  { date: "2027-05-03", name: "Early May Bank Holiday" },
  { date: "2027-08-30", name: "Summer Bank Holiday" },
  { date: "2027-12-25", name: "Christmas Day" },
  { date: "2027-12-27", name: "Boxing Day (substitute)" },
];

const CA_HOLIDAYS: CalendarHoliday[] = [
  { date: "2025-01-01", name: "New Year's Day" },
  { date: "2025-07-01", name: "Canada Day" },
  { date: "2025-09-01", name: "Labour Day" },
  { date: "2025-12-25", name: "Christmas Day" },
  { date: "2026-01-01", name: "New Year's Day" },
  { date: "2026-07-01", name: "Canada Day" },
  { date: "2026-09-07", name: "Labour Day" },
  { date: "2026-12-25", name: "Christmas Day" },
  { date: "2027-01-01", name: "New Year's Day" },
  { date: "2027-07-01", name: "Canada Day" },
  { date: "2027-09-06", name: "Labour Day" },
  { date: "2027-12-25", name: "Christmas Day" },
];

const AU_HOLIDAYS: CalendarHoliday[] = [
  { date: "2025-01-01", name: "New Year's Day" },
  { date: "2025-01-26", name: "Australia Day" },
  { date: "2025-04-25", name: "ANZAC Day" },
  { date: "2025-12-25", name: "Christmas Day" },
  { date: "2026-01-01", name: "New Year's Day" },
  { date: "2026-01-26", name: "Australia Day" },
  { date: "2026-04-25", name: "ANZAC Day" },
  { date: "2026-12-25", name: "Christmas Day" },
  { date: "2027-01-01", name: "New Year's Day" },
  { date: "2027-01-26", name: "Australia Day" },
  { date: "2027-04-25", name: "ANZAC Day" },
  { date: "2027-12-25", name: "Christmas Day" },
];

const AE_HOLIDAYS: CalendarHoliday[] = [
  { date: "2025-01-01", name: "New Year's Day" },
  { date: "2025-06-06", name: "Eid al-Adha (approx.)" },
  { date: "2025-12-02", name: "UAE National Day" },
  { date: "2025-12-03", name: "UAE National Day Holiday" },
  { date: "2026-01-01", name: "New Year's Day" },
  { date: "2026-05-27", name: "Eid al-Adha (approx.)" },
  { date: "2026-12-02", name: "UAE National Day" },
  { date: "2026-12-03", name: "UAE National Day Holiday" },
  { date: "2027-01-01", name: "New Year's Day" },
  { date: "2027-05-16", name: "Eid al-Adha (approx.)" },
  { date: "2027-12-02", name: "UAE National Day" },
  { date: "2027-12-03", name: "UAE National Day Holiday" },
];

const HOLIDAYS_BY_ISO: Record<string, CalendarHoliday[]> = {
  IN: IN_HOLIDAYS,
  US: US_HOLIDAYS,
  GB: GB_HOLIDAYS,
  CA: CA_HOLIDAYS,
  AU: AU_HOLIDAYS,
  AE: AE_HOLIDAYS,
};

/** ISO code, English name, primary IANA timezone. */
const COUNTRY_ROWS: Array<[iso: string, name: string, tz: string]> = [
  ["AF", "Afghanistan", "Asia/Kabul"],
  ["AL", "Albania", "Europe/Tirane"],
  ["DZ", "Algeria", "Africa/Algiers"],
  ["AD", "Andorra", "Europe/Andorra"],
  ["AO", "Angola", "Africa/Luanda"],
  ["AG", "Antigua and Barbuda", "America/Antigua"],
  ["AR", "Argentina", "America/Argentina/Buenos_Aires"],
  ["AM", "Armenia", "Asia/Yerevan"],
  ["AU", "Australia", "Australia/Sydney"],
  ["AT", "Austria", "Europe/Vienna"],
  ["AZ", "Azerbaijan", "Asia/Baku"],
  ["BS", "Bahamas", "America/Nassau"],
  ["BH", "Bahrain", "Asia/Bahrain"],
  ["BD", "Bangladesh", "Asia/Dhaka"],
  ["BB", "Barbados", "America/Barbados"],
  ["BY", "Belarus", "Europe/Minsk"],
  ["BE", "Belgium", "Europe/Brussels"],
  ["BZ", "Belize", "America/Belize"],
  ["BJ", "Benin", "Africa/Porto-Novo"],
  ["BT", "Bhutan", "Asia/Thimphu"],
  ["BO", "Bolivia", "America/La_Paz"],
  ["BA", "Bosnia and Herzegovina", "Europe/Sarajevo"],
  ["BW", "Botswana", "Africa/Gaborone"],
  ["BR", "Brazil", "America/Sao_Paulo"],
  ["BN", "Brunei", "Asia/Brunei"],
  ["BG", "Bulgaria", "Europe/Sofia"],
  ["BF", "Burkina Faso", "Africa/Ouagadougou"],
  ["BI", "Burundi", "Africa/Bujumbura"],
  ["CV", "Cabo Verde", "Atlantic/Cape_Verde"],
  ["KH", "Cambodia", "Asia/Phnom_Penh"],
  ["CM", "Cameroon", "Africa/Douala"],
  ["CA", "Canada", "America/Toronto"],
  ["CF", "Central African Republic", "Africa/Bangui"],
  ["TD", "Chad", "Africa/Ndjamena"],
  ["CL", "Chile", "America/Santiago"],
  ["CN", "China", "Asia/Shanghai"],
  ["CO", "Colombia", "America/Bogota"],
  ["KM", "Comoros", "Indian/Comoro"],
  ["CG", "Congo", "Africa/Brazzaville"],
  ["CD", "Congo (DRC)", "Africa/Kinshasa"],
  ["CR", "Costa Rica", "America/Costa_Rica"],
  ["CI", "Côte d'Ivoire", "Africa/Abidjan"],
  ["HR", "Croatia", "Europe/Zagreb"],
  ["CU", "Cuba", "America/Havana"],
  ["CY", "Cyprus", "Asia/Nicosia"],
  ["CZ", "Czechia", "Europe/Prague"],
  ["DK", "Denmark", "Europe/Copenhagen"],
  ["DJ", "Djibouti", "Africa/Djibouti"],
  ["DM", "Dominica", "America/Dominica"],
  ["DO", "Dominican Republic", "America/Santo_Domingo"],
  ["EC", "Ecuador", "America/Guayaquil"],
  ["EG", "Egypt", "Africa/Cairo"],
  ["SV", "El Salvador", "America/El_Salvador"],
  ["GQ", "Equatorial Guinea", "Africa/Malabo"],
  ["ER", "Eritrea", "Africa/Asmara"],
  ["EE", "Estonia", "Europe/Tallinn"],
  ["SZ", "Eswatini", "Africa/Mbabane"],
  ["ET", "Ethiopia", "Africa/Addis_Ababa"],
  ["FJ", "Fiji", "Pacific/Fiji"],
  ["FI", "Finland", "Europe/Helsinki"],
  ["FR", "France", "Europe/Paris"],
  ["GA", "Gabon", "Africa/Libreville"],
  ["GM", "Gambia", "Africa/Banjul"],
  ["GE", "Georgia", "Asia/Tbilisi"],
  ["DE", "Germany", "Europe/Berlin"],
  ["GH", "Ghana", "Africa/Accra"],
  ["GR", "Greece", "Europe/Athens"],
  ["GD", "Grenada", "America/Grenada"],
  ["GT", "Guatemala", "America/Guatemala"],
  ["GN", "Guinea", "Africa/Conakry"],
  ["GW", "Guinea-Bissau", "Africa/Bissau"],
  ["GY", "Guyana", "America/Guyana"],
  ["HT", "Haiti", "America/Port-au-Prince"],
  ["HN", "Honduras", "America/Tegucigalpa"],
  ["HK", "Hong Kong", "Asia/Hong_Kong"],
  ["HU", "Hungary", "Europe/Budapest"],
  ["IS", "Iceland", "Atlantic/Reykjavik"],
  ["IN", "India", "Asia/Kolkata"],
  ["ID", "Indonesia", "Asia/Jakarta"],
  ["IR", "Iran", "Asia/Tehran"],
  ["IQ", "Iraq", "Asia/Baghdad"],
  ["IE", "Ireland", "Europe/Dublin"],
  ["IL", "Israel", "Asia/Jerusalem"],
  ["IT", "Italy", "Europe/Rome"],
  ["JM", "Jamaica", "America/Jamaica"],
  ["JP", "Japan", "Asia/Tokyo"],
  ["JO", "Jordan", "Asia/Amman"],
  ["KZ", "Kazakhstan", "Asia/Almaty"],
  ["KE", "Kenya", "Africa/Nairobi"],
  ["KI", "Kiribati", "Pacific/Tarawa"],
  ["KW", "Kuwait", "Asia/Kuwait"],
  ["KG", "Kyrgyzstan", "Asia/Bishkek"],
  ["LA", "Laos", "Asia/Vientiane"],
  ["LV", "Latvia", "Europe/Riga"],
  ["LB", "Lebanon", "Asia/Beirut"],
  ["LS", "Lesotho", "Africa/Maseru"],
  ["LR", "Liberia", "Africa/Monrovia"],
  ["LY", "Libya", "Africa/Tripoli"],
  ["LI", "Liechtenstein", "Europe/Vaduz"],
  ["LT", "Lithuania", "Europe/Vilnius"],
  ["LU", "Luxembourg", "Europe/Luxembourg"],
  ["MO", "Macao", "Asia/Macau"],
  ["MG", "Madagascar", "Indian/Antananarivo"],
  ["MW", "Malawi", "Africa/Blantyre"],
  ["MY", "Malaysia", "Asia/Kuala_Lumpur"],
  ["MV", "Maldives", "Indian/Maldives"],
  ["ML", "Mali", "Africa/Bamako"],
  ["MT", "Malta", "Europe/Malta"],
  ["MH", "Marshall Islands", "Pacific/Majuro"],
  ["MR", "Mauritania", "Africa/Nouakchott"],
  ["MU", "Mauritius", "Indian/Mauritius"],
  ["MX", "Mexico", "America/Mexico_City"],
  ["FM", "Micronesia", "Pacific/Pohnpei"],
  ["MD", "Moldova", "Europe/Chisinau"],
  ["MC", "Monaco", "Europe/Monaco"],
  ["MN", "Mongolia", "Asia/Ulaanbaatar"],
  ["ME", "Montenegro", "Europe/Podgorica"],
  ["MA", "Morocco", "Africa/Casablanca"],
  ["MZ", "Mozambique", "Africa/Maputo"],
  ["MM", "Myanmar", "Asia/Yangon"],
  ["NA", "Namibia", "Africa/Windhoek"],
  ["NR", "Nauru", "Pacific/Nauru"],
  ["NP", "Nepal", "Asia/Kathmandu"],
  ["NL", "Netherlands", "Europe/Amsterdam"],
  ["NZ", "New Zealand", "Pacific/Auckland"],
  ["NI", "Nicaragua", "America/Managua"],
  ["NE", "Niger", "Africa/Niamey"],
  ["NG", "Nigeria", "Africa/Lagos"],
  ["KP", "North Korea", "Asia/Pyongyang"],
  ["MK", "North Macedonia", "Europe/Skopje"],
  ["NO", "Norway", "Europe/Oslo"],
  ["OM", "Oman", "Asia/Muscat"],
  ["PK", "Pakistan", "Asia/Karachi"],
  ["PW", "Palau", "Pacific/Palau"],
  ["PS", "Palestine", "Asia/Gaza"],
  ["PA", "Panama", "America/Panama"],
  ["PG", "Papua New Guinea", "Pacific/Port_Moresby"],
  ["PY", "Paraguay", "America/Asuncion"],
  ["PE", "Peru", "America/Lima"],
  ["PH", "Philippines", "Asia/Manila"],
  ["PL", "Poland", "Europe/Warsaw"],
  ["PT", "Portugal", "Europe/Lisbon"],
  ["PR", "Puerto Rico", "America/Puerto_Rico"],
  ["QA", "Qatar", "Asia/Qatar"],
  ["RO", "Romania", "Europe/Bucharest"],
  ["RU", "Russia", "Europe/Moscow"],
  ["RW", "Rwanda", "Africa/Kigali"],
  ["KN", "Saint Kitts and Nevis", "America/St_Kitts"],
  ["LC", "Saint Lucia", "America/St_Lucia"],
  ["VC", "Saint Vincent and the Grenadines", "America/St_Vincent"],
  ["WS", "Samoa", "Pacific/Apia"],
  ["SM", "San Marino", "Europe/San_Marino"],
  ["ST", "Sao Tome and Principe", "Africa/Sao_Tome"],
  ["SA", "Saudi Arabia", "Asia/Riyadh"],
  ["SN", "Senegal", "Africa/Dakar"],
  ["RS", "Serbia", "Europe/Belgrade"],
  ["SC", "Seychelles", "Indian/Mahe"],
  ["SL", "Sierra Leone", "Africa/Freetown"],
  ["SG", "Singapore", "Asia/Singapore"],
  ["SK", "Slovakia", "Europe/Bratislava"],
  ["SI", "Slovenia", "Europe/Ljubljana"],
  ["SB", "Solomon Islands", "Pacific/Guadalcanal"],
  ["SO", "Somalia", "Africa/Mogadishu"],
  ["ZA", "South Africa", "Africa/Johannesburg"],
  ["KR", "South Korea", "Asia/Seoul"],
  ["SS", "South Sudan", "Africa/Juba"],
  ["ES", "Spain", "Europe/Madrid"],
  ["LK", "Sri Lanka", "Asia/Colombo"],
  ["SD", "Sudan", "Africa/Khartoum"],
  ["SR", "Suriname", "America/Paramaribo"],
  ["SE", "Sweden", "Europe/Stockholm"],
  ["CH", "Switzerland", "Europe/Zurich"],
  ["SY", "Syria", "Asia/Damascus"],
  ["TW", "Taiwan", "Asia/Taipei"],
  ["TJ", "Tajikistan", "Asia/Dushanbe"],
  ["TZ", "Tanzania", "Africa/Dar_es_Salaam"],
  ["TH", "Thailand", "Asia/Bangkok"],
  ["TL", "Timor-Leste", "Asia/Dili"],
  ["TG", "Togo", "Africa/Lome"],
  ["TO", "Tonga", "Pacific/Tongatapu"],
  ["TT", "Trinidad and Tobago", "America/Port_of_Spain"],
  ["TN", "Tunisia", "Africa/Tunis"],
  ["TR", "Turkey", "Europe/Istanbul"],
  ["TM", "Turkmenistan", "Asia/Ashgabat"],
  ["TV", "Tuvalu", "Pacific/Funafuti"],
  ["UG", "Uganda", "Africa/Kampala"],
  ["UA", "Ukraine", "Europe/Kyiv"],
  ["AE", "United Arab Emirates", "Asia/Dubai"],
  ["GB", "United Kingdom", "Europe/London"],
  ["US", "United States", "America/New_York"],
  ["UY", "Uruguay", "America/Montevideo"],
  ["UZ", "Uzbekistan", "Asia/Tashkent"],
  ["VU", "Vanuatu", "Pacific/Efate"],
  ["VA", "Vatican City", "Europe/Vatican"],
  ["VE", "Venezuela", "America/Caracas"],
  ["VN", "Vietnam", "Asia/Ho_Chi_Minh"],
  ["ZM", "Zambia", "Africa/Lusaka"],
  ["ZW", "Zimbabwe", "Africa/Harare"],
];

export const CALENDAR_COUNTRIES: CalendarCountry[] = COUNTRY_ROWS.map(
  ([id, name, timeZone]) => ({
    id,
    name,
    timeZone,
    weekendDays: [...(FRI_SAT_ISO.has(id) ? FRI_SAT : SAT_SUN)],
    flagEmoji: flagEmoji(id),
    holidays: HOLIDAYS_BY_ISO[id] ?? [],
  }),
).sort((a, b) => a.name.localeCompare(b.name));

const BY_ID = new Map(CALENDAR_COUNTRIES.map((c) => [c.id, c]));

export function hasCalendarCountry(id: string): boolean {
  return BY_ID.has(id);
}

export function getCalendarCountry(id: string): CalendarCountry {
  return BY_ID.get(id) || BY_ID.get("IN")!;
}

export function holidayNameOn(
  country: CalendarCountry,
  ymd: string,
): string | null {
  return country.holidays.find((h) => h.date === ymd)?.name ?? null;
}

export function isWeekend(country: CalendarCountry, ymd: string): boolean {
  const [y, m, d] = ymd.split("-").map(Number);
  if (!y || !m || !d) return false;
  const day = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
  return country.weekendDays.includes(day);
}
