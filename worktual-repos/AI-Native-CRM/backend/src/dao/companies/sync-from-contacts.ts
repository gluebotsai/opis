import { Prisma } from "@prisma/client";
import { accountQuery } from "@/dao/db/account-pool";
import { prisma } from "@/dao/db/prisma";
import { countActiveProfilesForCompanyId } from "@/dao/contacts/contact-profile-repository";
import { countActiveContactsForCompanyName as countAccountContactsByCompanyName } from "@/dao/account/account-repository";
import { resolveRequestOrganizationId } from "@/service/auth/require-role";
import {
  collapseContactCompanies,
  headquartersName,
  normalizeCompanyDomain,
  planCompanyWrites,
  planMissingLocations,
  planProfileLinks,
  type DistinctContactCompany,
  type ExistingCompanySnapshot,
} from "@/dao/companies/company-contact-sync-plan";

export type ContactCompanyMeta = {
  name: string;
  domain?: string | null;
  industry?: string | null;
  city?: string | null;
};

async function findCompanyByName(name: string, organizationId?: string | null) {
  const include = { _count: { select: { locations: true as const } } };
  if (organizationId?.trim()) {
    const inOrg = await prisma.company.findFirst({
      where: {
        organizationId: organizationId.trim(),
        name: { equals: name, mode: "insensitive" },
      },
      include,
    });
    if (inOrg) return inOrg;
  }
  // DB unique index companies_name_lower_uidx — names are global, not per-tenant.
  return prisma.company.findFirst({
    where: { name: { equals: name, mode: "insensitive" } },
    include,
  });
}

async function enrichExistingCompany(
  existing: {
    id: string;
    organizationId: string;
    domain: string | null;
    industry: string | null;
    _count: { locations: number };
  },
  meta: ContactCompanyMeta,
) {
  const domain = normalizeCompanyDomain(meta.domain);
  const industry = meta.industry?.trim();
  if ((domain && !existing.domain) || (industry && !existing.industry)) {
    await prisma.company.update({
      where: { id: existing.id },
      data: {
        ...(domain && !existing.domain ? { domain } : {}),
        ...(industry && !existing.industry ? { industry } : {}),
      },
    });
    if (domain && !existing.domain) existing.domain = domain;
    if (industry && !existing.industry) existing.industry = industry;
  }
  if (existing._count.locations === 0) {
    await prisma.companyLocation.create({
      data: {
        organizationId: existing.organizationId,
        companyId: existing.id,
        name: meta.city?.trim() || "Headquarters",
        type: "hq",
        city: meta.city?.trim() || null,
        industry: industry || existing.industry,
      },
    });
    existing._count.locations = 1;
  }
}

export async function countActiveContactsForCompanyId(
  companyId: string,
): Promise<number> {
  return countActiveProfilesForCompanyId(companyId);
}

export async function countActiveContactsForCompanyName(
  companyName: string,
): Promise<number> {
  return countAccountContactsByCompanyName(companyName);
}

/** @deprecated use countActiveContactsForCompanyId */
export async function countActiveContactsForCompany(companyName: string) {
  return countActiveContactsForCompanyName(companyName);
}

/**
 * Remove CRM company when no active contacts still reference it by id
 * (falls back to name for legacy rows).
 */
export async function removeCompanyIfNoContacts(args: {
  companyId?: string | null;
  companyName?: string | null;
}): Promise<boolean> {
  const companyId = args.companyId?.trim() || null;
  const companyName = args.companyName?.trim() || null;

  if (companyId) {
    const remaining = await countActiveContactsForCompanyId(companyId);
    if (remaining > 0) return false;
    const company = await prisma.company.findUnique({ where: { id: companyId } });
    if (!company) return false;
    await prisma.company.delete({ where: { id: companyId } });
    return true;
  }

  if (!companyName) return false;
  const remaining = await countActiveContactsForCompanyName(companyName);
  if (remaining > 0) return false;
  const company = await findCompanyByName(companyName);
  if (!company) return false;
  await prisma.company.delete({ where: { id: company.id } });
  return true;
}

export async function ensureCompanyFromContact(
  meta: ContactCompanyMeta & { organizationId?: string | null },
): Promise<{ id: string; created: boolean }> {
  const name = meta.name.trim();
  if (!name) {
    throw new Error("Company name is required.");
  }

  const organizationId = await resolveRequestOrganizationId(meta.organizationId);

  const existing = await findCompanyByName(name, organizationId);
  if (existing) {
    if (existing.organizationId !== organizationId) {
      await prisma.company.update({
        where: { id: existing.id },
        data: { organizationId },
      });
    }
    await enrichExistingCompany(existing, meta);
    return { id: existing.id, created: false };
  }

  try {
    const company = await prisma.company.create({
      data: {
        organizationId,
        name,
        domain: normalizeCompanyDomain(meta.domain),
        industry: meta.industry?.trim() || null,
        locations: {
          create: {
            organizationId,
            name: meta.city?.trim() || "Headquarters",
            type: "hq",
            city: meta.city?.trim() || null,
            industry: meta.industry?.trim() || null,
          },
        },
      },
    });
    return { id: company.id, created: true };
  } catch (err) {
    if (
      err instanceof Prisma.PrismaClientKnownRequestError &&
      err.code === "P2002"
    ) {
      // Race / global lower(name) unique — reuse whatever row exists.
      const again = await findCompanyByName(name);
      if (again) {
        if (again.organizationId !== organizationId) {
          await prisma.company.update({
            where: { id: again.id },
            data: { organizationId },
          });
        }
        await enrichExistingCompany(again, meta);
        return { id: again.id, created: false };
      }
    }
    throw err;
  }
}

export async function getCompanySnapshot(companyId: string): Promise<{
  id: string;
  name: string;
  domain: string | null;
  industry: string | null;
  employeeCount: number | null;
  linkedinUrl: string | null;
  ownerUserId: string | null;
} | null> {
  // Raw SQL so a stale Turbopack-bundled Prisma client (missing linkedinUrl in
  // its DMMF) cannot break the contact detail page after schema adds.
  const rows = await prisma.$queryRawUnsafe<
    Array<{
      id: string;
      name: string;
      domain: string | null;
      industry: string | null;
      employee_count: number | null;
      linkedin_url: string | null;
      owner_user_id: string | null;
    }>
  >(
    `
    SELECT id, name, domain, industry, employee_count, linkedin_url, owner_user_id
    FROM companies
    WHERE id = $1
    LIMIT 1
    `,
    companyId,
  );
  const row = rows[0];
  if (!row) return null;
  return {
    id: row.id,
    name: row.name,
    domain: row.domain,
    industry: row.industry,
    employeeCount: row.employee_count,
    linkedinUrl: row.linkedin_url,
    ownerUserId: row.owner_user_id,
  };
}

export async function getCompanyLocationSummary(
  companyId: string,
  locationId: string,
) {
  return prisma.companyLocation.findFirst({
    where: { id: locationId, companyId },
    select: { id: true, name: true, city: true, address: true, type: true },
  });
}

/**
 * After a contact create/update/delete: ensure the new company exists (if any),
 * and remove the previous company when it no longer has any contacts.
 */
export async function syncCompanyForContactChange(args: {
  previousCompanyId?: string | null;
  previousCompanyName?: string | null;
  nextCompanyId?: string | null;
  nextCompanyName?: string | null;
  nextDomain?: string | null;
  nextIndustry?: string | null;
  nextCity?: string | null;
  organizationId?: string | null;
}): Promise<{ companyId: string | null }> {
  const previousId = args.previousCompanyId?.trim() || null;
  const previousName = args.previousCompanyName?.trim() || null;
  let nextId = args.nextCompanyId?.trim() || null;
  const nextName = args.nextCompanyName?.trim() || null;

  if (nextId) {
    const exists = await prisma.company.findUnique({ where: { id: nextId } });
    if (!exists) nextId = null;
  }

  if (!nextId && nextName) {
    const ensured = await ensureCompanyFromContact({
      name: nextName,
      domain: args.nextDomain,
      industry: args.nextIndustry,
      city: args.nextCity,
      organizationId: args.organizationId,
    });
    nextId = ensured.id;
  }

  const previousChanged =
    (previousId || previousName) &&
    (previousId !== nextId ||
      (!previousId &&
        previousName &&
        (!nextName || previousName.toLowerCase() !== nextName.toLowerCase())));

  if (previousChanged) {
    await removeCompanyIfNoContacts({
      companyId: previousId,
      companyName: previousId ? null : previousName,
    });
  }

  return { companyId: nextId };
}

const WRITE_BATCH = 200;

type CompanySyncResult = {
  scanned: number;
  created: number;
  removed: number;
  linked: number;
  organizations: number;
};

function chunked<T>(rows: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < rows.length; i += size) {
    chunks.push(rows.slice(i, i + size));
  }
  return chunks;
}

function isUniqueConflict(err: unknown): boolean {
  return (
    err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002"
  );
}

async function loadCompanySnapshots(
  organizationId: string,
): Promise<ExistingCompanySnapshot[]> {
  const companies = await prisma.company.findMany({
    where: { organizationId },
    select: {
      id: true,
      name: true,
      domain: true,
      industry: true,
      _count: { select: { locations: true } },
    },
  });
  return companies.map((company) => ({
    id: company.id,
    name: company.name,
    domain: company.domain,
    industry: company.industry,
    locationCount: company._count.locations,
  }));
}

async function createMissingCompanies(
  organizationId: string,
  rows: Array<{
    name: string;
    domain: string | null;
    industry: string | null;
    city: string | null;
  }>,
): Promise<number> {
  let created = 0;
  for (const chunk of chunked(rows, WRITE_BATCH)) {
    try {
      const result = await prisma.company.createMany({
        data: chunk.map((row) => ({
          organizationId,
          name: row.name,
          domain: row.domain,
          industry: row.industry,
        })),
      });
      created += result.count;
    } catch (err) {
      if (!isUniqueConflict(err)) throw err;
      for (const row of chunk) {
        const ensured = await ensureCompanyFromContact({
          name: row.name,
          domain: row.domain,
          industry: row.industry,
          city: row.city,
          organizationId,
        });
        if (ensured.created) created += 1;
      }
    }
  }
  return created;
}

async function enrichCompanies(
  rows: Array<{ id: string; domain: string | null; industry: string | null }>,
): Promise<void> {
  for (const chunk of chunked(rows, WRITE_BATCH)) {
    await prisma.$executeRawUnsafe(
      `UPDATE crm.companies AS c
       SET domain = COALESCE(c.domain, NULLIF(v.domain, '')),
           industry = COALESCE(c.industry, NULLIF(v.industry, '')),
           updated_at = NOW()
       FROM unnest($1::text[], $2::text[], $3::text[]) AS v(id, domain, industry)
       WHERE c.id = v.id
         AND (
           (c.domain IS NULL AND NULLIF(v.domain, '') IS NOT NULL)
           OR (c.industry IS NULL AND NULLIF(v.industry, '') IS NOT NULL)
         )`,
      chunk.map((row) => row.id),
      chunk.map((row) => row.domain ?? ""),
      chunk.map((row) => row.industry ?? ""),
    );
  }
}

async function createMissingLocations(
  organizationId: string,
  rows: Array<{ companyId: string; city: string | null; industry: string | null }>,
): Promise<void> {
  for (const chunk of chunked(rows, WRITE_BATCH)) {
    await prisma.companyLocation.createMany({
      data: chunk.map((row) => ({
        organizationId,
        companyId: row.companyId,
        name: headquartersName(row.city),
        type: "hq",
        city: row.city?.trim() || null,
        industry: row.industry?.trim() || null,
      })),
    });
  }
}

async function linkContactProfiles(
  organizationId: string,
  rows: Array<{ accountContactId: string; companyId: string }>,
  kind: "insert" | "update",
): Promise<number> {
  let linked = 0;
  for (const chunk of chunked(rows, WRITE_BATCH)) {
    if (kind === "insert") {
      const result = await prisma.contactProfile.createMany({
        data: chunk.map((row) => ({
          accountContactId: row.accountContactId,
          organizationId,
          companyId: row.companyId,
        })),
        skipDuplicates: true,
      });
      linked += result.count;
      continue;
    }
    const updated = await prisma.$executeRawUnsafe(
      `UPDATE crm.contact_profiles AS cp
       SET company_id = v.company_id,
           organization_id = v.organization_id::bigint,
           updated_at = NOW()
       FROM unnest($1::text[], $2::text[], $3::text[]) AS v(account_contact_id, company_id, organization_id)
       WHERE cp.account_contact_id = v.account_contact_id
         AND cp.company_id IS NULL`,
      chunk.map((row) => row.accountContactId),
      chunk.map((row) => row.companyId),
      chunk.map(() => organizationId),
    );
    linked += Number(updated) || 0;
  }
  return linked;
}

/**
 * Backfill one organization's companies from contact company names, then link
 * profiles that do not yet point at a company. A handful of set queries —
 * not one round trip per name or contact.
 */
async function syncOneOrganization(
  organizationId: string,
): Promise<CompanySyncResult> {
  const { rows } = await accountQuery<DistinctContactCompany>(
    `SELECT
       organization_id::text AS organization_id,
       trim(company) AS name,
       max(nullif(trim(custom_fields->>'company_domain'), '')) AS domain,
       max(nullif(trim(custom_fields->>'industry'), '')) AS industry,
       max(nullif(trim(city), '')) AS city
     FROM cdp.customer_profile
     WHERE company IS NOT NULL
       AND trim(company) <> ''
       AND organization_id = $1::bigint
     GROUP BY organization_id, trim(company)
     ORDER BY trim(company)`,
    [organizationId],
  );
  const canonical = collapseContactCompanies(rows);
  if (canonical.length === 0) {
    return { scanned: 0, created: 0, removed: 0, linked: 0, organizations: 1 };
  }

  const before = await loadCompanySnapshots(organizationId);
  const writes = planCompanyWrites(canonical, before);
  const created = await createMissingCompanies(organizationId, writes.create);
  if (writes.enrich.length) await enrichCompanies(writes.enrich);

  const snapshots =
    writes.create.length > 0
      ? await loadCompanySnapshots(organizationId)
      : before;
  const locations = planMissingLocations(snapshots, canonical);
  if (locations.length) {
    await createMissingLocations(organizationId, locations);
  }

  const companyIdByLowerName = new Map<string, string>();
  for (const company of snapshots) {
    const key = company.name.trim().toLowerCase();
    if (!companyIdByLowerName.has(key)) {
      companyIdByLowerName.set(key, company.id);
    }
  }

  const [{ rows: contacts }, profiles] = await Promise.all([
    accountQuery<{ id: string; name: string }>(
      `SELECT cdp_id::text AS id, lower(trim(company)) AS name
       FROM cdp.customer_profile
       WHERE organization_id = $1::bigint
         AND company IS NOT NULL
         AND trim(company) <> ''`,
      [organizationId],
    ),
    prisma.contactProfile.findMany({
      where: { organizationId },
      select: { accountContactId: true, companyId: true },
    }),
  ]);
  const links = planProfileLinks({
    contacts: contacts.map((contact) => ({
      id: contact.id,
      companyName: contact.name,
    })),
    profiles,
    companyIdByLowerName,
  });
  const linked =
    (await linkContactProfiles(organizationId, links.insert, "insert")) +
    (await linkContactProfiles(organizationId, links.update, "update"));

  return {
    scanned: canonical.length,
    created,
    removed: 0,
    linked,
    organizations: 1,
  };
}

/**
 * Backfill CRM companies and link contact_profiles.company_id by company name.
 * Companies are first-class records: a company with no contacts yet stays in the list.
 * Called from the company-contact-sync cron, not from the company list request.
 */
export async function syncCompaniesFromContacts(options?: {
  organizationId?: string | null;
}): Promise<CompanySyncResult> {
  const organizationId = options?.organizationId?.trim() || null;
  if (organizationId) return syncOneOrganization(organizationId);

  const { rows } = await accountQuery<{ organization_id: string }>(
    `SELECT DISTINCT organization_id::text AS organization_id
     FROM cdp.customer_profile
     WHERE company IS NOT NULL
       AND trim(company) <> ''
       AND organization_id IS NOT NULL`,
  );
  let scanned = 0;
  let created = 0;
  let linked = 0;
  for (const row of rows) {
    const orgId = row.organization_id?.trim();
    if (!orgId) continue;
    const result = await syncOneOrganization(orgId);
    scanned += result.scanned;
    created += result.created;
    linked += result.linked;
  }
  return {
    scanned,
    created,
    removed: 0,
    linked,
    organizations: rows.length,
  };
}

/** Scheduled backfill. Does not run on GET /api/companies. */
export async function syncCompaniesFromContactsSweep(): Promise<CompanySyncResult> {
  const started = Date.now();
  const result = await syncCompaniesFromContacts();
  if (result.created > 0 || result.linked > 0) {
    console.info(
      `[company-contact-sync] organizations=${result.organizations} scanned=${result.scanned} created=${result.created} linked=${result.linked} ms=${Date.now() - started}`,
    );
  }
  return result;
}
