/**
 * Contact list search. A typed query matches the fields on the contact.
 * A created-date phrase narrows to that calendar day (Asia/Kolkata).
 */

const MONTHS: Record<string, number> = {
  jan: 1,
  january: 1,
  feb: 2,
  february: 2,
  mar: 3,
  march: 3,
  apr: 4,
  april: 4,
  may: 5,
  jun: 6,
  june: 6,
  jul: 7,
  july: 7,
  aug: 8,
  august: 8,
  sep: 9,
  sept: 9,
  september: 9,
  oct: 10,
  october: 10,
  nov: 11,
  november: 11,
  dec: 12,
  december: 12,
};

const MONTH =
  "jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?";

const FILLER = new Set([
  "a",
  "address",
  "an",
  "all",
  "are",
  "been",
  "by",
  "city",
  "company",
  "contact",
  "contacts",
  "country",
  "created",
  "date",
  "day",
  "email",
  "filter",
  "for",
  "from",
  "has",
  "have",
  "in",
  "lead",
  "leads",
  "list",
  "location",
  "me",
  "name",
  "number",
  "of",
  "on",
  "only",
  "owned",
  "owner",
  "phone",
  "please",
  "show",
  "source",
  "stage",
  "stages",
  "status",
  "that",
  "the",
  "those",
  "to",
  "was",
  "were",
  "which",
  "who",
  "whose",
  "wise",
  "with",
]);

const LEAD_STATUSES = new Set([
  "new",
  "contacted",
  "qualifying",
  "qualified",
  "disqualified",
  "converted",
]);

const CONTACT_TYPES = new Set([
  "contact",
  "lead",
  "prospect",
  "customer",
  "churned",
]);

export type InterpretedContactSearch = {
  text: string;
  createdOn: string | null;
};

export function interpretContactListSearch(
  raw: string,
  now = new Date(),
): InterpretedContactSearch {
  const source = raw.trim();
  if (!source) return { text: "", createdOn: null };
  const found = findDate(source, now);
  const withoutDate = found
    ? `${source.slice(0, found.start)} ${source.slice(found.end)}`
    : source;
  const remainder = withoutDate
    .split(/\s+/)
    .map((token) => token.replace(/^[,.]+|[,.]+$/g, ""))
    .filter((token) => token && !FILLER.has(token.toLowerCase()))
    .join(" ")
    .trim();
  if (!remainder && !found) return { text: source, createdOn: null };
  return { text: remainder, createdOn: found?.iso ?? null };
}

export function normalizeLeadStatusFilter(
  raw: string | null | undefined,
): string | null {
  const value = raw?.trim().toLowerCase().replace(/[\s_-]+/g, "") ?? "";
  if (!value || value === "all") return null;
  return LEAD_STATUSES.has(value) ? value : null;
}

export function normalizeContactTypeFilter(
  raw: string | null | undefined,
): string | null {
  let value = raw?.trim().toLowerCase().replace(/[\s_-]+/g, "") ?? "";
  if (!value || value === "all" || value === "allstages") return null;
  if (value.endsWith("s") && CONTACT_TYPES.has(value.slice(0, -1))) {
    value = value.slice(0, -1);
  }
  return CONTACT_TYPES.has(value) ? value : null;
}

/** Accept ISO or a written date. Year defaults to `now` when omitted. */
export function normalizeCreatedOn(
  raw: string | null | undefined,
  now = new Date(),
): string | null {
  const value = raw?.trim();
  if (!value) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(value) && calendarDate(value)) return value;
  return findDate(value, now)?.iso ?? null;
}

export function createdDayRange(isoDate: string): { start: Date; end: Date } | null {
  if (!calendarDate(isoDate)) return null;
  const start = new Date(`${isoDate}T00:00:00+05:30`);
  if (Number.isNaN(start.getTime())) return null;
  return { start, end: new Date(start.getTime() + 24 * 60 * 60 * 1000) };
}

function findDate(
  source: string,
  now: Date,
): { iso: string; start: number; end: number } | null {
  const yearDefault = now.getFullYear();
  const patterns: RegExp[] = [
    /\b(\d{4})-(\d{2})-(\d{2})\b/,
    /\b(\d{1,2})[/. -](\d{1,2})[/. -](\d{4})\b/,
    new RegExp(`\\b(\\d{1,2})(?:st|nd|rd|th)?\\s+(${MONTH})(?:\\s+(\\d{4}))?\\b`, "i"),
    new RegExp(`\\b(${MONTH})\\s+(\\d{1,2})(?:st|nd|rd|th)?(?:,)?(?:\\s+(\\d{4}))?\\b`, "i"),
  ];
  for (const pattern of patterns) {
    const match = pattern.exec(source);
    if (!match) continue;
    const iso = isoFromMatch(pattern, match, yearDefault);
    if (!iso) continue;
    return { iso, start: match.index, end: match.index + match[0].length };
  }
  return null;
}

function isoFromMatch(pattern: RegExp, match: RegExpExecArray, yearDefault: number): string | null {
  const body = pattern.source;
  if (body.startsWith("\\b(\\d{4})")) {
    return calendarDate(`${match[1]}-${pad(match[2])}-${pad(match[3])}`);
  }
  if (body.includes("[/. -]")) {
    const day = Number(match[1]);
    const month = Number(match[2]);
    const year = Number(match[3]);
    return calendarDate(`${year}-${pad(month)}-${pad(day)}`);
  }
  if (body.startsWith("\\b(\\d{1,2})")) {
    const day = Number(match[1]);
    const month = MONTHS[match[2].toLowerCase()];
    const year = match[3] ? Number(match[3]) : yearDefault;
    return calendarDate(`${year}-${pad(month)}-${pad(day)}`);
  }
  const month = MONTHS[match[1].toLowerCase()];
  const day = Number(match[2]);
  const year = match[3] ? Number(match[3]) : yearDefault;
  return calendarDate(`${year}-${pad(month)}-${pad(day)}`);
}

function calendarDate(iso: string): string | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  const probe = new Date(Date.UTC(year, month - 1, day));
  if (
    probe.getUTCFullYear() !== year ||
    probe.getUTCMonth() !== month - 1 ||
    probe.getUTCDate() !== day
  ) {
    return null;
  }
  return iso;
}

function pad(value: string | number | undefined): string {
  return String(value ?? "").padStart(2, "0");
}

export async function findContactIdsCreatedOn(
  createdOn: string,
  organizationId: string,
): Promise<string[]> {
  const range = createdDayRange(createdOn);
  if (!range) return [];
  const { accountQuery } = await import("@/dao/db/account-pool");
  const { rows } = await accountQuery<{ id: string }>(
    `SELECT p.cdp_id::text AS id
     FROM cdp.customer_profile p
     WHERE p.organization_id = $1::bigint
       AND p.created_at >= $2
       AND p.created_at < $3
     LIMIT 5000`,
    [organizationId, range.start, range.end],
  );
  return rows.map((row) => row.id);
}

export async function findContactIdsByLeadSource(
  leadSource: string,
  organizationId: string,
): Promise<string[]> {
  const like = `%${leadSource.trim()}%`;
  if (like === "%%") return [];
  const { prisma } = await import("@/dao/db/prisma");
  const rows = await prisma.$queryRaw<{ account_contact_id: string }[]>`
    SELECT account_contact_id
    FROM crm.contact_profiles
    WHERE organization_id = ${BigInt(organizationId)}
      AND coalesce(lead_source, '') ILIKE ${like}
    LIMIT 5000
  `;
  return rows.map((row) => row.account_contact_id);
}

export async function findContactIdsByPlace(
  place: string,
  organizationId: string,
): Promise<string[]> {
  const q = place.trim();
  if (!q) return [];
  const { accountQuery } = await import("@/dao/db/account-pool");
  const { prisma } = await import("@/dao/db/prisma");
  const like = `%${q}%`;
  const people = await accountQuery<{ id: string }>(
    `SELECT p.cdp_id::text AS id
     FROM cdp.customer_profile p
     WHERE p.organization_id = $1::bigint
       AND (
         coalesce(p.city, '') ILIKE $2
         OR coalesce(p.country, '') ILIKE $2
         OR coalesce(p.region, '') ILIKE $2
         OR coalesce(p.custom_fields->>'city', '') ILIKE $2
         OR coalesce(p.custom_fields->>'country', '') ILIKE $2
         OR coalesce(p.custom_fields->>'address_line', '') ILIKE $2
         OR coalesce(p.custom_fields->>'location', '') ILIKE $2
       )
     LIMIT 5000`,
    [organizationId, like],
  );
  const locations = await prisma.companyLocation.findMany({
    where: {
      organizationId: BigInt(organizationId),
      OR: [
        { city: { contains: q, mode: "insensitive" } },
        { address: { contains: q, mode: "insensitive" } },
        { name: { contains: q, mode: "insensitive" } },
      ],
    },
    select: { id: true },
    take: 500,
  });
  const locationIds = locations.map((row) => row.id);
  const linked = locationIds.length
    ? await prisma.contactProfile.findMany({
        where: {
          organizationId: BigInt(organizationId),
          locationId: { in: locationIds },
        },
        select: { accountContactId: true },
        take: 5000,
      })
    : [];
  return [
    ...new Set([
      ...people.rows.map((row) => row.id),
      ...linked.map((row) => row.accountContactId),
    ]),
  ];
}

export async function findContactIdsByEmail(
  email: string,
  organizationId: string,
): Promise<string[]> {
  const q = email.trim();
  if (!q) return [];
  const { accountQuery } = await import("@/dao/db/account-pool");
  const { rows } = await accountQuery<{ id: string }>(
    `SELECT DISTINCT k.cdp_id::text AS id
     FROM cdp.identity_keys k
     JOIN cdp.customer_profile p ON p.cdp_id = k.cdp_id
     WHERE p.organization_id = $1::bigint
       AND k.key_type IN ('email', 'email_secondary')
       AND coalesce(k.key_value, '') ILIKE $2
     LIMIT 5000`,
    [organizationId, `%${q}%`],
  );
  return rows.map((row) => row.id);
}

export async function findContactIdsByPhone(
  phone: string,
  organizationId: string,
): Promise<string[]> {
  const digits = phone.replace(/\D/g, "");
  const text = phone.trim();
  if (digits.length < 3 && text.length < 3) return [];
  const { accountQuery } = await import("@/dao/db/account-pool");
  const useDigits = digits.length >= 3;
  const { rows } = await accountQuery<{ id: string }>(
    `SELECT DISTINCT k.cdp_id::text AS id
     FROM cdp.identity_keys k
     JOIN cdp.customer_profile p ON p.cdp_id = k.cdp_id
     WHERE p.organization_id = $1::bigint
       AND k.key_type IN ('phone', 'phone_secondary')
       AND (
         coalesce(k.key_value, '') ILIKE $2
         OR ($4::boolean AND regexp_replace(coalesce(k.key_value, ''), '[^0-9]', '', 'g') LIKE $3)
       )
     LIMIT 5000`,
    [organizationId, `%${text}%`, `%${digits}%`, useDigits],
  );
  return rows.map((row) => row.id);
}
