import type { OrganizationVertical } from "@prisma/client";
import { prisma } from "@/dao/db/prisma";
import { accountQuery } from "@/dao/db/account-pool";
import {
  getVerticalPack,
  mapIndustryTypeToVertical,
  type VerticalPack,
} from "@/lib/vertical-packs";

export type OrganizationProfileView = {
  organizationId: string;
  /** Raw `accounts.organizations.industry_type` (signup). */
  industryType: string | null;
  /** Mapped CRM field pack. */
  vertical: OrganizationVertical;
  verticalConfig: Record<string, unknown>;
  pack: VerticalPack;
};

/** derived | manual | needs_manual — see backend/src/service/account/internal-domains.ts */
export type InternalDomainsMode = "derived" | "manual" | "needs_manual";

export type InternalDomainsState = {
  organizationId: string;
  domains: string[];
  mode: InternalDomainsMode;
  overrideEmails: string[];
  updatedAt: string | null;
};

function toInternalDomainsMode(value: string | null | undefined): InternalDomainsMode {
  if (value === "manual" || value === "needs_manual") return value;
  return "derived";
}

function asConfig(value: unknown): Record<string, unknown> {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return {};
}

async function readAccountsIndustryType(
  organizationId: string,
): Promise<string | null> {
  const id = organizationId.trim();
  if (!id) return null;
  try {
    const { rows } = await accountQuery<{ industry_type: string | null }>(
      `SELECT industry_type
       FROM accounts.organizations
       WHERE id = $1::bigint
       LIMIT 1`,
      [id],
    );
    const raw = rows[0]?.industry_type?.trim();
    return raw ? raw : null;
  } catch (err) {
    console.error("readAccountsIndustryType failed", err);
    return null;
  }
}

/**
 * Tenant industry comes from accounts (signup). CRM only maps it to a field pack.
 * `crm.organization_profiles.vertical` is not the source of truth.
 */
export async function getOrganizationProfile(
  organizationId: string,
): Promise<OrganizationProfileView> {
  const [industryType, row] = await Promise.all([
    readAccountsIndustryType(organizationId),
    prisma.organizationProfile.findUnique({
      where: { organizationId },
    }),
  ]);
  const vertical = mapIndustryTypeToVertical(industryType);
  return {
    organizationId,
    industryType,
    vertical,
    verticalConfig: asConfig(row?.verticalConfig),
    pack: getVerticalPack(vertical),
  };
}

/**
 * Internal-domains resolver state (foundation for future Internal Meeting
 * Assist routing). `crm.organization_profiles.internal_domains*` — CRM-owned,
 * upserts the one-row-per-org profile if it doesn't exist yet.
 */
export async function getInternalDomainsState(
  organizationId: string,
): Promise<InternalDomainsState> {
  const row = await prisma.organizationProfile.findUnique({
    where: { organizationId },
  });
  return {
    organizationId,
    domains: row?.internalDomains ?? [],
    mode: toInternalDomainsMode(row?.internalDomainsMode),
    overrideEmails: row?.internalDomainOverrides ?? [],
    updatedAt: row?.internalDomainsUpdatedAt?.toISOString() ?? null,
  };
}

async function upsertInternalDomainsFields(
  organizationId: string,
  data: {
    internalDomains?: string[];
    internalDomainsMode?: InternalDomainsMode;
    internalDomainOverrides?: string[];
  },
): Promise<InternalDomainsState> {
  const row = await prisma.organizationProfile.upsert({
    where: { organizationId },
    create: {
      organizationId,
      internalDomains: data.internalDomains ?? [],
      internalDomainsMode: data.internalDomainsMode ?? "derived",
      internalDomainOverrides: data.internalDomainOverrides ?? [],
      internalDomainsUpdatedAt: new Date(),
    },
    update: {
      ...(data.internalDomains !== undefined
        ? { internalDomains: data.internalDomains }
        : {}),
      ...(data.internalDomainsMode !== undefined
        ? { internalDomainsMode: data.internalDomainsMode }
        : {}),
      ...(data.internalDomainOverrides !== undefined
        ? { internalDomainOverrides: data.internalDomainOverrides }
        : {}),
      internalDomainsUpdatedAt: new Date(),
    },
  });
  return {
    organizationId,
    domains: row.internalDomains,
    mode: toInternalDomainsMode(row.internalDomainsMode),
    overrideEmails: row.internalDomainOverrides,
    updatedAt: row.internalDomainsUpdatedAt?.toISOString() ?? null,
  };
}

/** Persist a fresh auto-derived domain set. */
export async function saveDerivedInternalDomains(
  organizationId: string,
  domains: string[],
): Promise<InternalDomainsState> {
  return upsertInternalDomainsFields(organizationId, {
    internalDomains: domains,
    internalDomainsMode: domains.length > 0 ? "derived" : "needs_manual",
  });
}

/** Admin-entered domain list — takes precedence over auto-derivation. */
export async function saveManualInternalDomains(
  organizationId: string,
  domains: string[],
): Promise<InternalDomainsState> {
  return upsertInternalDomainsFields(organizationId, {
    internalDomains: domains,
    internalDomainsMode: "manual",
  });
}

/** Admin-entered specific-email overrides (alias/personal-email edge case). */
export async function saveInternalDomainOverrides(
  organizationId: string,
  overrideEmails: string[],
): Promise<InternalDomainsState> {
  return upsertInternalDomainsFields(organizationId, {
    internalDomainOverrides: overrideEmails,
  });
}
