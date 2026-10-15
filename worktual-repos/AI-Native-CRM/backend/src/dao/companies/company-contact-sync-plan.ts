/**
 * Pure planning for the contact → company backfill.
 * The company list must not run this work. The cron sweep applies the plan
 * in a few set queries instead of one round trip per company and contact.
 */

export type DistinctContactCompany = {
  organization_id: string;
  name: string;
  domain: string | null;
  industry: string | null;
  city: string | null;
};

export type CanonicalContactCompany = {
  organizationId: string;
  name: string;
  domain: string | null;
  industry: string | null;
  city: string | null;
};

export type ExistingCompanySnapshot = {
  id: string;
  name: string;
  domain: string | null;
  industry: string | null;
  locationCount: number;
};

export type CompanyInsert = {
  name: string;
  domain: string | null;
  industry: string | null;
  city: string | null;
};

export type CompanyEnrich = {
  id: string;
  domain: string | null;
  industry: string | null;
};

export type CompanyLocationInsert = {
  companyId: string;
  city: string | null;
  industry: string | null;
};

export type ProfileLink = {
  accountContactId: string;
  companyId: string;
};

export function normalizeCompanyDomain(
  value: string | null | undefined,
): string | null {
  const domain = value
    ?.trim()
    .toLowerCase()
    .replace(/^https?:\/\//, "")
    .replace(/^www\./, "")
    .split("/")[0];
  return domain || null;
}

export function headquartersName(city: string | null | undefined): string {
  return city?.trim() || "Headquarters";
}

/** One row per organization + lowercased name. First spelling wins; later rows fill blanks. */
export function collapseContactCompanies(
  rows: DistinctContactCompany[],
): CanonicalContactCompany[] {
  const byKey = new Map<string, CanonicalContactCompany>();
  for (const row of rows) {
    const organizationId = row.organization_id?.trim();
    const name = row.name?.trim();
    if (!organizationId || !name) continue;
    const key = `${organizationId}:${name.toLowerCase()}`;
    const domain = normalizeCompanyDomain(row.domain);
    const industry = row.industry?.trim() || null;
    const city = row.city?.trim() || null;
    const existing = byKey.get(key);
    if (!existing) {
      byKey.set(key, { organizationId, name, domain, industry, city });
      continue;
    }
    if (!existing.domain && domain) existing.domain = domain;
    if (!existing.industry && industry) existing.industry = industry;
    if (!existing.city && city) existing.city = city;
  }
  return [...byKey.values()];
}

export function planCompanyWrites(
  canonical: CanonicalContactCompany[],
  existing: ExistingCompanySnapshot[],
): { create: CompanyInsert[]; enrich: CompanyEnrich[] } {
  const byName = new Map<string, ExistingCompanySnapshot>();
  for (const company of existing) {
    const key = company.name.trim().toLowerCase();
    if (!byName.has(key)) byName.set(key, company);
  }

  const create: CompanyInsert[] = [];
  const enrich: CompanyEnrich[] = [];
  for (const row of canonical) {
    const found = byName.get(row.name.toLowerCase());
    if (!found) {
      create.push({
        name: row.name,
        domain: row.domain,
        industry: row.industry,
        city: row.city,
      });
      continue;
    }
    const domain = !found.domain && row.domain ? row.domain : null;
    const industry = !found.industry && row.industry ? row.industry : null;
    if (domain || industry) {
      enrich.push({ id: found.id, domain, industry });
    }
  }
  return { create, enrich };
}

/** Headquarters for companies that still have no location and match a contact company name. */
export function planMissingLocations(
  companies: ExistingCompanySnapshot[],
  canonical: CanonicalContactCompany[],
): CompanyLocationInsert[] {
  const byName = new Map<string, CanonicalContactCompany>();
  for (const row of canonical) {
    const key = row.name.trim().toLowerCase();
    if (!byName.has(key)) byName.set(key, row);
  }
  const locations: CompanyLocationInsert[] = [];
  for (const company of companies) {
    if (company.locationCount > 0) continue;
    const row = byName.get(company.name.trim().toLowerCase());
    if (!row) continue;
    locations.push({
      companyId: company.id,
      city: row.city,
      industry: company.industry || row.industry,
    });
  }
  return locations;
}

/**
 * Link a contact only when its profile has no company yet.
 * A profile that already points at a company is left alone.
 */
export function planProfileLinks(args: {
  contacts: Array<{ id: string; companyName: string }>;
  profiles: Array<{ accountContactId: string; companyId: string | null }>;
  companyIdByLowerName: Map<string, string>;
}): { insert: ProfileLink[]; update: ProfileLink[] } {
  const profileById = new Map(
    args.profiles.map((profile) => [
      profile.accountContactId,
      profile.companyId,
    ]),
  );
  const seen = new Set<string>();
  const insert: ProfileLink[] = [];
  const update: ProfileLink[] = [];
  for (const contact of args.contacts) {
    const id = contact.id?.trim();
    const name = contact.companyName?.trim().toLowerCase();
    if (!id || !name || seen.has(id)) continue;
    seen.add(id);
    const companyId = args.companyIdByLowerName.get(name);
    if (!companyId) continue;
    if (!profileById.has(id)) {
      insert.push({ accountContactId: id, companyId });
      continue;
    }
    if (!profileById.get(id)) {
      update.push({ accountContactId: id, companyId });
    }
  }
  return { insert, update };
}
