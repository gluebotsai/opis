/** Shared CSV helpers for Audience + create-campaign temporary uploads. */

export type ParsedContactRow = {
  firstName?: string;
  lastName?: string;
  email?: string;
  phone?: string;
  companyName?: string;
  city?: string;
  name?: string;
};

function toCsvCell(value: string): string {
  if (/[",\n\r]/.test(value)) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

/** Minimal CSV line splitter (handles quoted commas). */
export function splitCsvLine(line: string): string[] {
  const out: string[] = [];
  let cur = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"') {
        if (line[i + 1] === '"') {
          cur += '"';
          i += 1;
        } else {
          inQuotes = false;
        }
      } else {
        cur += ch;
      }
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === ",") {
      out.push(cur);
      cur = "";
    } else {
      cur += ch;
    }
  }
  out.push(cur);
  return out;
}

function normalizeHeader(h: string): string {
  return h.trim().toLowerCase().replace(/[\s_-]+/g, "");
}

/** Parse contact CSV into rows (Name/Email/Phone/Company/City or firstName…). */
export function parseContactsCsv(text: string): ParsedContactRow[] {
  const lines = text
    .replace(/^\uFEFF/, "")
    .split(/\r?\n/)
    .map((l) => l.trimEnd())
    .filter((l) => l.trim().length > 0);
  if (lines.length < 2) return [];

  const headers = splitCsvLine(lines[0]).map(normalizeHeader);
  const idx = (aliases: string[]) =>
    headers.findIndex((h) => aliases.includes(h));

  const iName = idx(["name", "fullname", "contactname"]);
  const iFirst = idx(["firstname", "first", "givenname"]);
  const iLast = idx(["lastname", "last", "surname", "familyname"]);
  const iEmail = idx(["email", "emailaddress", "mail"]);
  const iPhone = idx([
    "phone",
    "phonenumber",
    "mobile",
    "whatsapp",
    "whatsappnumber",
  ]);
  const iCompany = idx(["company", "companyname", "organisation", "organization"]);
  const iCity = idx(["city", "town"]);

  const rows: ParsedContactRow[] = [];
  for (let li = 1; li < lines.length; li += 1) {
    const cols = splitCsvLine(lines[li]);
    const get = (i: number) => (i >= 0 ? String(cols[i] ?? "").trim() : "");
    const name = get(iName);
    const firstName = get(iFirst);
    const lastName = get(iLast);
    const email = get(iEmail);
    const phone = get(iPhone);
    const companyName = get(iCompany);
    const city = get(iCity);
    if (!name && !firstName && !email && !phone) continue;
    rows.push({
      name: name || undefined,
      firstName: firstName || undefined,
      lastName: lastName || undefined,
      email: email || undefined,
      phone: phone || undefined,
      companyName: companyName || undefined,
      city: city || undefined,
    });
  }
  return rows;
}

export function contactsCsvTemplate(): string {
  return (
    ["firstName", "lastName", "email", "phone", "companyName", "city"]
      .map(toCsvCell)
      .join(",") + "\n"
  );
}
