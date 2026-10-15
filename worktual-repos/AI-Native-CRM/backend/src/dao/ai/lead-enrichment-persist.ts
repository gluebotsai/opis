import { prisma } from "@/dao/db/prisma";
import { getContact, updateContact } from "@/dao/contacts/contact-service";
import { writeAuditLog } from "@/dao/audit/audit-log";
import { upsertLeadEnrichmentSnapshot } from "@/dao/ai/lead-enrichment-snapshot";
import {
  companyIdentityAllowsDomain,
  companyNameMatchesDomain,
  companyNameMatchesLinkedinUrl,
  emailDomain,
  isGenericLocationLabel,
  isPlausibleCompanyAddress,
  isPlausibleLogoUrl,
  isTrustedFirmographicSource,
  logoUrlBelongsToCompany,
  normalizeCompanyCity,
} from "@/service/ai/lead-enrichment-types";
import type {
  EnrichmentFieldKey,
  LeadEnrichmentPayload,
} from "@/service/ai/lead-enrichment-types";
import {
  classifySeniorityTier,
  emailDomainType,
} from "@/service/ai/lead-score";
import { resolveRequestOrganizationId } from "@/service/auth/require-role";
import { locationFromInbound, splitGeography } from "@/lib/inbound-location";

function blank(value: string | number | null | undefined): boolean {
  if (value == null) return true;
  if (typeof value === "number") return false;
  return !String(value).trim();
}

const JUNK_PRODUCT_NAMES = new Set([
  "brands",
  "products",
  "services",
  "offerings",
  "all markets",
  "markets",
  "solutions",
  "industries",
]);

function isLikelyYearNotHeadcount(n: number): boolean {
  return n >= 1990 && n <= 2035;
}

function normalizeProducts(raw: string | number | null | undefined): string | null {
  if (raw == null) return null;
  const parts = String(raw)
    .split(/[;|,]/)
    .map((p) => p.trim())
    .filter((p) => {
      if (p.length < 2 || p.length > 80) return false;
      if (JUNK_PRODUCT_NAMES.has(p.toLowerCase())) return false;
      if (/^\|/.test(p) || /^[a-z_]+\s*=/i.test(p) || /[=:]$/.test(p)) {
        return false;
      }
      return true;
    })
    .slice(0, 16);
  return parts.length ? [...new Set(parts)].join("; ") : null;
}

function normalizeDescription(
  raw: string | number | null | undefined,
): string | null {
  const text = String(raw ?? "")
    .replace(/\s+/g, " ")
    .trim();
  if (text.length < 40 || text.length > 900) return null;
  return text.slice(0, 800);
}

/**
 * Fill blanks only on Company / HQ / Contact from agent payload.
 * Never overwrites populated user data. Writes audit provenance.
 */
export async function persistLeadEnrichment(
  payload: LeadEnrichmentPayload,
  options?: { organizationId?: string | null; actorUserId?: string | null },
): Promise<{
  ok: true;
  filled: EnrichmentFieldKey[];
  companyId: string | null;
  conflictFlags: string[];
}> {
  const contact = await getContact(payload.contactId);
  if (!contact) throw new Error("Contact not found.");

  const organizationId = await resolveRequestOrganizationId(options?.organizationId);
  const fields = payload.fields ?? {};
  const filled: EnrichmentFieldKey[] = [];
  const conflictFlags: string[] = [];
  const sources: Record<string, { confidence: number; sourceUrl?: string | null }> =
    {};

  function flagConflict(
    key: EnrichmentFieldKey,
    existing: string | number | null | undefined,
    incoming: string | number | null | undefined,
  ) {
    if (blank(existing) || incoming == null || blank(incoming)) return;
    const a = String(existing).trim().toLowerCase();
    const b = String(incoming).trim().toLowerCase();
    if (a && b && a !== b) conflictFlags.push(key);
  }

  let companyId = contact.person.companyId;
  let locationId = contact.person.locationId;
  let hqCityForContact: string | null = null;

  // Ensure company exists when we have a name to attach enrichment to.
  const incomingName =
    typeof fields.companyName?.value === "string"
      ? fields.companyName.value.trim()
      : null;
  const companyName =
    incomingName ||
    contact.person.company?.name ||
    null;

  if (!companyId && companyName) {
    const existing = await prisma.company.findFirst({
      where: {
        organizationId,
        name: { equals: companyName, mode: "insensitive" },
      },
      select: { id: true },
    });
    if (existing) {
      companyId = existing.id;
    } else {
      const created = await prisma.company.create({
        data: {
          organizationId,
          name: companyName,
          locations: {
            create: {
              organizationId,
              name: "Headquarters",
              type: "hq",
            },
          },
        },
        select: { id: true, locations: { select: { id: true, type: true } } },
      });
      companyId = created.id;
      locationId =
        created.locations.find((l) => l.type === "hq")?.id ??
        created.locations[0]?.id ??
        null;
      filled.push("companyName");
    }
  }

  if (companyId) {
    let company = await prisma.company.findFirst({
      where: { id: companyId, organizationId },
      include: { locations: { where: { type: "hq" }, take: 1 } },
    });
    // Company may have been created under the default/demo tenant before
    // contacts moved to the real org — reclaim it for this tenant.
    if (!company) {
      const orphan = await prisma.company.findFirst({
        where: { id: companyId },
        include: { locations: { where: { type: "hq" }, take: 1 } },
      });
      if (orphan) {
        await prisma.company.update({
          where: { id: orphan.id },
          data: { organizationId },
        });
        company = { ...orphan, organizationId };
      }
    }
    if (!company) throw new Error("Company not found for tenant.");

    // Read linkedin / logo via SQL — Turbopack may still hold a Prisma client
    // without these columns in its DMMF after a schema add.
    const extraRows = await prisma.$queryRawUnsafe<
      Array<{ linkedin_url: string | null; logo_url: string | null }>
    >(
      `SELECT linkedin_url, logo_url FROM companies WHERE id = $1 LIMIT 1`,
      company.id,
    );
    const existingLinkedin = extraRows[0]?.linkedin_url ?? null;
    const existingLogo = extraRows[0]?.logo_url ?? null;

    const companyPatch: {
      domain?: string | null;
      industry?: string;
      employeeCount?: number | null;
    } = {};
    let nextLinkedin: string | null = null;
    let clearLinkedin = false;
    let nextLogo: string | null = null;
    let clearLogo = false;

    const existingDomainTrusted = companyNameMatchesDomain(
      companyName,
      company.domain,
    );
    if (!blank(company.domain) && !existingDomainTrusted) {
      companyPatch.domain = null;
    }

    if (fields.domain && typeof fields.domain.value === "string") {
      if (existingDomainTrusted) {
        flagConflict("domain", company.domain, fields.domain.value);
      }
    }
    const incomingDomain =
      fields.domain && typeof fields.domain.value === "string"
        ? fields.domain.value
            .trim()
            .toLowerCase()
            .replace(/^https?:\/\//, "")
            .replace(/^www\./, "")
            .split("/")[0]!
        : "";
    const wikiEvidence = [
      typeof fields.companyDescription?.value === "string"
        ? fields.companyDescription.value
        : "",
      fields.companyDescription?.sourceUrl,
      fields.domain?.sourceUrl,
    ]
      .filter(Boolean)
      .join(" ");
    const foreignFirmographics =
      Boolean(incomingDomain) &&
      !companyIdentityAllowsDomain(companyName, incomingDomain, {
        evidenceText: wikiEvidence,
        sourceUrl:
          (typeof fields.domain?.sourceUrl === "string"
            ? fields.domain.sourceUrl
            : null) ||
          (typeof fields.companyDescription?.sourceUrl === "string"
            ? fields.companyDescription.sourceUrl
            : null),
      });
    if (
      fields.domain &&
      (blank(company.domain) || !existingDomainTrusted) &&
      incomingDomain &&
      companyIdentityAllowsDomain(companyName, incomingDomain, {
        evidenceText: wikiEvidence,
        sourceUrl:
          (typeof fields.domain?.sourceUrl === "string"
            ? fields.domain.sourceUrl
            : null) ||
          (typeof fields.companyDescription?.sourceUrl === "string"
            ? fields.companyDescription.sourceUrl
            : null),
      }) &&
      (fields.domain.confidence ?? 0) >= 50
    ) {
      companyPatch.domain = incomingDomain;
      filled.push("domain");
      sources.domain = {
        confidence: fields.domain.confidence,
        sourceUrl: fields.domain.sourceUrl,
      };
    }

    if (fields.industry && typeof fields.industry.value === "string") {
      flagConflict("industry", company.industry, fields.industry.value);
    }
    if (
      !foreignFirmographics &&
      fields.industry &&
      blank(company.industry) &&
      typeof fields.industry.value === "string" &&
      fields.industry.value.trim() &&
      (fields.industry.confidence ?? 0) >= 45
    ) {
      companyPatch.industry = fields.industry.value.trim();
      filled.push("industry");
      sources.industry = {
        confidence: fields.industry.confidence,
        sourceUrl: fields.industry.sourceUrl,
      };
    }

    if (
      company.employeeCount != null &&
      isLikelyYearNotHeadcount(company.employeeCount)
    ) {
      companyPatch.employeeCount = null;
    }

    const trustedDomainForEmp =
      (typeof companyPatch.domain === "string" ? companyPatch.domain : null) ||
      (existingDomainTrusted ? company.domain : null);
    const incomingEmp =
      fields.employeeCount && typeof fields.employeeCount.value === "number"
        ? Math.round(fields.employeeCount.value)
        : null;
    const incomingEmpOk =
      incomingEmp != null &&
      incomingEmp > 0 &&
      !isLikelyYearNotHeadcount(incomingEmp);
    const empTrusted =
      incomingEmpOk &&
      (fields.employeeCount?.confidence ?? 0) >= 70 &&
      isTrustedFirmographicSource(
        fields.employeeCount?.sourceUrl,
        trustedDomainForEmp,
      );
    if (
      incomingEmpOk &&
      company.employeeCount != null &&
      incomingEmp !== company.employeeCount
    ) {
      flagConflict("employeeCount", company.employeeCount, incomingEmp);
    }
    if (
      !foreignFirmographics &&
      incomingEmpOk &&
      (fields.employeeCount?.confidence ?? 0) >= 40 &&
      (company.employeeCount == null ||
        (empTrusted && incomingEmp !== company.employeeCount))
    ) {
      companyPatch.employeeCount = incomingEmp;
      filled.push("employeeCount");
      sources.employeeCount = {
        confidence: fields.employeeCount?.confidence,
        sourceUrl: fields.employeeCount?.sourceUrl,
      };
    }

    if (
      !blank(existingLinkedin) &&
      !companyNameMatchesLinkedinUrl(companyName, existingLinkedin)
    ) {
      clearLinkedin = true;
    }
    if (
      fields.linkedinUrl &&
      (blank(existingLinkedin) || clearLinkedin) &&
      typeof fields.linkedinUrl.value === "string" &&
      /linkedin\.com\/company\//i.test(fields.linkedinUrl.value) &&
      (companyNameMatchesLinkedinUrl(companyName, fields.linkedinUrl.value) ||
        companyIdentityAllowsDomain(companyName, fields.linkedinUrl.value, {
          evidenceText: wikiEvidence,
          sourceUrl:
            typeof fields.linkedinUrl.sourceUrl === "string"
              ? fields.linkedinUrl.sourceUrl
              : null,
        })) &&
      (fields.linkedinUrl.confidence ?? 0) >= 50
    ) {
      nextLinkedin = fields.linkedinUrl.value
        .trim()
        .replace(/\/$/, "")
        .split("?")[0]!;
      clearLinkedin = false;
      filled.push("linkedinUrl");
      sources.linkedinUrl = {
        confidence: fields.linkedinUrl.confidence,
        sourceUrl: fields.linkedinUrl.sourceUrl,
      };
    }

    const trustedDomainForLogo =
      (typeof companyPatch.domain === "string" ? companyPatch.domain : null) ||
      (existingDomainTrusted ? company.domain : null);
    if (
      !blank(existingLogo) &&
      !logoUrlBelongsToCompany(companyName, existingLogo, {
        companyDomain: trustedDomainForLogo,
      })
    ) {
      clearLogo = true;
    }
    if (
      fields.logoUrl &&
      (blank(existingLogo) || clearLogo) &&
      typeof fields.logoUrl.value === "string" &&
      isPlausibleLogoUrl(fields.logoUrl.value) &&
      logoUrlBelongsToCompany(companyName, fields.logoUrl.value, {
        sourceUrl: fields.logoUrl.sourceUrl,
        companyDomain: trustedDomainForLogo,
        evidenceText: wikiEvidence,
      }) &&
      (fields.logoUrl.confidence ?? 0) >= 40
    ) {
      nextLogo = fields.logoUrl.value.trim();
      clearLogo = false;
      filled.push("logoUrl");
      sources.logoUrl = {
        confidence: fields.logoUrl.confidence,
        sourceUrl: fields.logoUrl.sourceUrl,
      };
    }

    if (Object.keys(companyPatch).length) {
      await prisma.company.update({
        where: { id: company.id },
        data: companyPatch,
      });
    }
    if (nextLinkedin) {
      await prisma.$executeRawUnsafe(
        `UPDATE companies SET linkedin_url = $2, updated_at = NOW() WHERE id = $1`,
        company.id,
        nextLinkedin,
      );
    } else if (clearLinkedin) {
      await prisma.$executeRawUnsafe(
        `UPDATE companies SET linkedin_url = NULL, updated_at = NOW() WHERE id = $1`,
        company.id,
      );
    }
    if (nextLogo) {
      await prisma.$executeRawUnsafe(
        `UPDATE companies SET logo_url = $2, updated_at = NOW() WHERE id = $1`,
        company.id,
        nextLogo,
      );
    } else if (clearLogo) {
      await prisma.$executeRawUnsafe(
        `UPDATE companies SET logo_url = NULL, updated_at = NOW() WHERE id = $1`,
        company.id,
      );
    }

    let hq = company.locations[0] ?? null;
    if (!hq) {
      hq = await prisma.companyLocation.create({
        data: {
          organizationId: company.organizationId,
          companyId: company.id,
          name: "Headquarters",
          type: "hq",
        },
      });
    }
    locationId = locationId || hq.id;

    const locPatch: { city?: string; address?: string; name?: string } = {};
    const incomingCity =
      fields.city && typeof fields.city.value === "string"
        ? normalizeCompanyCity(fields.city.value)
        : null;
    const cityBlankOrGeneric =
      blank(hq.city) || isGenericLocationLabel(hq.city);
    const cityTrusted =
      Boolean(incomingCity) &&
      (fields.city?.confidence ?? 0) >= 70 &&
      isTrustedFirmographicSource(
        fields.city?.sourceUrl,
        trustedDomainForEmp,
      );
    if (
      !foreignFirmographics &&
      incomingCity &&
      (fields.city?.confidence ?? 0) >= 45 &&
      (cityBlankOrGeneric ||
        (cityTrusted &&
          incomingCity.toLowerCase() !== (hq.city ?? "").trim().toLowerCase()))
    ) {
      locPatch.city = incomingCity;
      filled.push("city");
      sources.city = {
        confidence: fields.city?.confidence,
        sourceUrl: fields.city?.sourceUrl,
      };
      if (isGenericLocationLabel(hq.name) || cityTrusted) {
        locPatch.name = incomingCity.split(",")[0]!.trim();
      }
    }
    if (
      !foreignFirmographics &&
      fields.address &&
      blank(hq.address) &&
      typeof fields.address.value === "string" &&
      isPlausibleCompanyAddress(fields.address.value) &&
      (fields.address.confidence ?? 0) >= 45
    ) {
      locPatch.address = fields.address.value.trim();
      filled.push("address");
      sources.address = {
        confidence: fields.address.confidence,
        sourceUrl: fields.address.sourceUrl,
      };
    }
    if (Object.keys(locPatch).length) {
      await prisma.companyLocation.update({
        where: { id: hq.id },
        data: locPatch,
      });
    }
    hqCityForContact = locPatch.city || incomingCity || hq.city || null;
  }

  // Contact: title + verified company/location links + write-through projections.
  const contactPatch: Parameters<typeof updateContact>[1] = {};
  if (fields.title && typeof fields.title.value === "string") {
    flagConflict("title", contact.person.title, fields.title.value);
  }
  if (
    fields.title &&
    blank(contact.person.title) &&
    typeof fields.title.value === "string" &&
    fields.title.value.trim() &&
    (fields.title.confidence ?? 0) >= 50
  ) {
    contactPatch.title = fields.title.value.trim();
    filled.push("title");
    sources.title = {
      confidence: fields.title.confidence,
      sourceUrl: fields.title.sourceUrl,
    };
  }

  if (companyId && !contact.person.companyId) {
    contactPatch.companyId = companyId;
  }
  if (locationId && !contact.person.locationId) {
    contactPatch.locationId = locationId;
  }

  if (companyId) {
    const fresh = await prisma.company.findUnique({
      where: { id: companyId },
      select: { name: true, domain: true, industry: true },
    });
    if (fresh) {
      if (blank(contact.person.company?.domain) && fresh.domain) {
        contactPatch.companyDomain = fresh.domain;
      }
      if (blank(contact.person.company?.industry) && fresh.industry) {
        contactPatch.companyIndustry = fresh.industry;
      }
      if (blank(contact.person.company?.name) && fresh.name) {
        contactPatch.companyName = fresh.name;
      }
    }
  }

  const hqCity =
    hqCityForContact ||
    (fields.city && typeof fields.city.value === "string"
      ? normalizeCompanyCity(fields.city.value)
      : null);
  if (blank(contact.person.city) || blank(contact.person.country)) {
    const geo = splitGeography(hqCity);
    const fromPhone = locationFromInbound(
      { phone: contact.person.phone },
      contact.person.phone,
    );
    if (blank(contact.person.city) && (geo.city || hqCity)) {
      contactPatch.city = geo.city || hqCity;
    }
    if (blank(contact.person.country) && (geo.country || fromPhone.country)) {
      contactPatch.country = geo.country || fromPhone.country;
    }
  }

  if (Object.keys(contactPatch).length) {
    await updateContact(payload.contactId, contactPatch);
  }

  const snapshotDomain =
    typeof fields.domain?.value === "string" ? fields.domain.value : "";
  const snapshotEvidence = [
    typeof fields.companyDescription?.value === "string"
      ? fields.companyDescription.value
      : "",
    fields.companyDescription?.sourceUrl,
    fields.domain?.sourceUrl,
  ]
    .filter(Boolean)
    .join(" ");
  const foreignSnapshot =
    Boolean(snapshotDomain) &&
    !companyIdentityAllowsDomain(companyName, snapshotDomain, {
      evidenceText: snapshotEvidence,
      sourceUrl:
        (typeof fields.domain?.sourceUrl === "string"
          ? fields.domain.sourceUrl
          : null) ||
        (typeof fields.companyDescription?.sourceUrl === "string"
          ? fields.companyDescription.sourceUrl
          : null),
    });

  let companyDescription: string | null = null;
  if (
    !foreignSnapshot &&
    fields.companyDescription &&
    (fields.companyDescription.confidence ?? 0) >= 40
  ) {
    companyDescription = normalizeDescription(fields.companyDescription.value);
    if (companyDescription) {
      filled.push("companyDescription");
      sources.companyDescription = {
        confidence: fields.companyDescription.confidence,
        sourceUrl: fields.companyDescription.sourceUrl,
      };
    }
  }
  let products: string | null = null;
  if (
    !foreignSnapshot &&
    fields.products &&
    (fields.products.confidence ?? 0) >= 40
  ) {
    products = normalizeProducts(fields.products.value);
    if (products) {
      filled.push("products");
      sources.products = {
        confidence: fields.products.confidence,
        sourceUrl: fields.products.sourceUrl,
      };
    }
  }

  if (filled.length) {
    await writeAuditLog({
      action: "update",
      entityType: "contact",
      entityId: payload.contactId,
      organizationId,
      actorUserId: options?.actorUserId ?? null,
      meta: {
        source: "lead_enrichment",
        filled,
        sources,
        companyId,
        conflictFlags,
      },
    });
    if (companyId) {
      await writeAuditLog({
        action: "update",
        entityType: "company",
        entityId: companyId,
        organizationId,
        actorUserId: options?.actorUserId ?? null,
        meta: {
          source: "lead_enrichment",
          filled,
          sources,
          contactId: payload.contactId,
          conflictFlags,
        },
      });
    }
  }

  const titleAfter =
    (typeof contactPatch.title === "string"
      ? contactPatch.title
      : contact.person.title) || null;
  const seniority = classifySeniorityTier(titleAfter);
  const domainType = emailDomainType(contact.person.email);
  const companyFresh = companyId
    ? await prisma.company.findFirst({
        where: { id: companyId },
        select: {
          name: true,
          industry: true,
          employeeCount: true,
          domain: true,
        },
      })
    : null;
  const confidences = Object.values(sources).map((s) => s.confidence);
  const avgConfidence =
    confidences.length > 0
      ? confidences.reduce((a, b) => a + b, 0) / confidences.length
      : null;

  await upsertLeadEnrichmentSnapshot({
    organizationId,
    contactId: payload.contactId,
    companyName: companyFresh?.name ?? companyName,
    companySize:
      companyFresh?.employeeCount != null
        ? String(companyFresh.employeeCount)
        : null,
    industry: companyFresh?.industry ?? null,
    companyDescription,
    products,
    seniorityTier: seniority,
    geography:
      (companyId
        ? (
            await prisma.companyLocation.findFirst({
              where: { companyId, type: "hq" },
              select: { city: true },
            })
          )?.city
        : null) ||
      contact.person.city ||
      contact.person.country ||
      null,
    emailDomainType: domainType,
    enrichmentConfidence: avgConfidence,
    enrichmentSource: "scrape_wikidata",
    conflictFlags: conflictFlags.length ? conflictFlags : null,
  });

  return { ok: true, filled, companyId, conflictFlags };
}
