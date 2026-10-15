/**
 * Durable sales assignment settings (CRM DB).
 * Org threshold + per-rep capacity / PTO / tier / country.
 */

import type { SalesSeniorityTier } from "@prisma/client";
import { Prisma } from "@prisma/client";
import { prisma } from "@/dao/db/prisma";
import {
  DEFAULT_FOLLOWUP_POLICY,
  parseFollowupPolicy,
  type FollowupPolicy,
} from "@/lib/owner-working-hours";

export type SeniorityTier = "junior" | "mid" | "senior";

export const DEFAULT_SENIOR_AMOUNT_THRESHOLD = 50_000;

export type RepAssignmentProfile = {
  userId: string;
  acceptingLeads: boolean;
  maxOpenDeals: number | null;
  seniorityTier: SeniorityTier | null;
  onPtoUntil: string | null;
  country: string | null;
};

export type LeadIcpConfig = {
  targetIndustries?: string[];
  adjacentIndustries?: string[];
  sizeTiers?: string[];
  serviceableGeos?: string[];
};

export type OrgAssignmentSettingsView = {
  organizationId: string;
  seniorAmountThreshold: number;
  leadIcp: LeadIcpConfig | null;
  followupPolicy: FollowupPolicy;
  updatedAt: string;
  updatedByUserId: string | null;
};

function parseLeadIcp(raw: unknown): LeadIcpConfig | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const o = raw as Record<string, unknown>;
  const strArr = (v: unknown) =>
    Array.isArray(v)
      ? v.filter((x): x is string => typeof x === "string" && Boolean(x.trim()))
      : undefined;
  return {
    targetIndustries: strArr(o.targetIndustries),
    adjacentIndustries: strArr(o.adjacentIndustries),
    sizeTiers: strArr(o.sizeTiers),
    serviceableGeos: strArr(o.serviceableGeos),
  };
}

export type SalesAssignmentConfig = {
  seniorAmountThreshold: number;
  reps: Record<string, RepAssignmentProfile>;
};

function toDateOnly(value: Date | null | undefined): string | null {
  if (!value) return null;
  return value.toISOString().slice(0, 10);
}

function parseTier(
  value: SalesSeniorityTier | string | null | undefined,
): SeniorityTier | null {
  if (value === "junior" || value === "mid" || value === "senior") return value;
  return null;
}

export function isOnPto(
  onPtoUntil: string | null | undefined,
  now = new Date(),
): boolean {
  if (!onPtoUntil?.trim()) return false;
  const end = new Date(`${onPtoUntil.trim()}T23:59:59.999Z`);
  if (Number.isNaN(end.getTime())) return false;
  return now.getTime() <= end.getTime();
}

/** Load org settings; create with product seed threshold on first access. */
export async function getOrCreateOrgAssignmentSettings(
  organizationId: string,
  updatedByUserId?: string | null,
): Promise<OrgAssignmentSettingsView> {
  const oid = BigInt(organizationId);
  const existing = await prisma.orgAssignmentSettings.findUnique({
    where: { organizationId: oid },
  });
  if (existing) {
    return {
      organizationId: existing.organizationId.toString(),
      seniorAmountThreshold: existing.seniorAmountThreshold,
      leadIcp: parseLeadIcp(existing.leadIcp),
      followupPolicy: parseFollowupPolicy(existing.followupPolicy),
      updatedAt: existing.updatedAt.toISOString(),
      updatedByUserId:
        existing.updatedByUserId == null
          ? null
          : existing.updatedByUserId.toString(),
    };
  }

  const created = await prisma.orgAssignmentSettings.create({
    data: {
      organizationId: oid,
      seniorAmountThreshold: DEFAULT_SENIOR_AMOUNT_THRESHOLD,
      updatedByUserId:
        updatedByUserId != null && updatedByUserId !== ""
          ? BigInt(updatedByUserId)
          : null,
    },
  });
  return {
    organizationId: created.organizationId.toString(),
    seniorAmountThreshold: created.seniorAmountThreshold,
    leadIcp: parseLeadIcp(created.leadIcp),
    followupPolicy: DEFAULT_FOLLOWUP_POLICY,
    updatedAt: created.updatedAt.toISOString(),
    updatedByUserId:
      created.updatedByUserId == null
        ? null
        : created.updatedByUserId.toString(),
  };
}

export async function updateOrgAssignmentSettings(input: {
  organizationId: string;
  seniorAmountThreshold?: number;
  leadIcp?: LeadIcpConfig | null;
  followupPolicy?: FollowupPolicy | null;
  updatedByUserId: string | null;
}): Promise<OrgAssignmentSettingsView> {
  const existing = await getOrCreateOrgAssignmentSettings(
    input.organizationId,
    input.updatedByUserId,
  );
  const threshold =
    input.seniorAmountThreshold !== undefined
      ? Math.max(0, Math.floor(input.seniorAmountThreshold))
      : existing.seniorAmountThreshold;
  const leadIcp =
    input.leadIcp !== undefined ? input.leadIcp : existing.leadIcp;
  const followupPolicy =
    input.followupPolicy !== undefined && input.followupPolicy !== null
      ? parseFollowupPolicy(input.followupPolicy)
      : existing.followupPolicy;
  const oid = BigInt(input.organizationId);
  const leadIcpJson =
    leadIcp === null
      ? Prisma.JsonNull
      : leadIcp
        ? (leadIcp as Prisma.InputJsonValue)
        : undefined;
  const row = await prisma.orgAssignmentSettings.upsert({
    where: { organizationId: oid },
    create: {
      organizationId: oid,
      seniorAmountThreshold: threshold,
      leadIcp: leadIcpJson === Prisma.JsonNull ? undefined : leadIcpJson,
      followupPolicy: followupPolicy as Prisma.InputJsonValue,
      updatedByUserId:
        input.updatedByUserId != null && input.updatedByUserId !== ""
          ? BigInt(input.updatedByUserId)
          : null,
    },
    update: {
      seniorAmountThreshold: threshold,
      ...(leadIcpJson !== undefined ? { leadIcp: leadIcpJson } : {}),
      followupPolicy: followupPolicy as Prisma.InputJsonValue,
      updatedByUserId:
        input.updatedByUserId != null && input.updatedByUserId !== ""
          ? BigInt(input.updatedByUserId)
          : null,
    },
  });
  return {
    organizationId: row.organizationId.toString(),
    seniorAmountThreshold: row.seniorAmountThreshold,
    leadIcp: parseLeadIcp(row.leadIcp),
    followupPolicy: parseFollowupPolicy(row.followupPolicy),
    updatedAt: row.updatedAt.toISOString(),
    updatedByUserId:
      row.updatedByUserId == null ? null : row.updatedByUserId.toString(),
  };
}

export async function listRepAssignmentProfiles(
  organizationId: string,
): Promise<Map<string, RepAssignmentProfile>> {
  const rows = await prisma.salesUserAssignmentProfile.findMany({
    where: { organizationId: BigInt(organizationId) },
  });
  const map = new Map<string, RepAssignmentProfile>();
  for (const row of rows) {
    map.set(row.userId.toString(), {
      userId: row.userId.toString(),
      acceptingLeads: row.acceptingLeads,
      maxOpenDeals: row.maxOpenDeals,
      seniorityTier: parseTier(row.seniorityTier),
      onPtoUntil: toDateOnly(row.onPtoUntil),
      country: row.country?.trim() || null,
    });
  }
  return map;
}

export async function getSalesAssignmentConfig(
  organizationId: string,
): Promise<SalesAssignmentConfig> {
  const org = await getOrCreateOrgAssignmentSettings(organizationId);
  const reps = await listRepAssignmentProfiles(organizationId);
  const repMap: Record<string, RepAssignmentProfile> = {};
  for (const [userId, profile] of reps) {
    repMap[userId] = profile;
  }
  return {
    seniorAmountThreshold: org.seniorAmountThreshold,
    reps: repMap,
  };
}

export type UpsertRepAssignmentInput = {
  organizationId: string;
  userId: string;
  acceptingLeads?: boolean;
  maxOpenDeals?: number | null;
  seniorityTier?: SeniorityTier | null;
  onPtoUntil?: string | null;
  country?: string | null;
};

function parseOnPtoDate(raw: string | null | undefined): Date | null {
  if (raw == null) return null;
  const trimmed = raw.trim();
  if (!trimmed) return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) {
    throw new Error("onPtoUntil must be YYYY-MM-DD.");
  }
  const d = new Date(`${trimmed}T00:00:00.000Z`);
  if (Number.isNaN(d.getTime())) {
    throw new Error("onPtoUntil is not a valid date.");
  }
  return d;
}

export async function upsertRepAssignmentProfile(
  input: UpsertRepAssignmentInput,
): Promise<RepAssignmentProfile> {
  const tier =
    input.seniorityTier === undefined
      ? undefined
      : input.seniorityTier === null
        ? null
        : parseTier(input.seniorityTier);

  if (
    input.seniorityTier !== undefined &&
    input.seniorityTier !== null &&
    tier == null
  ) {
    throw new Error("seniorityTier must be junior, mid, or senior.");
  }

  let maxOpenDeals: number | null | undefined = input.maxOpenDeals;
  if (maxOpenDeals !== undefined && maxOpenDeals !== null) {
    if (!Number.isFinite(maxOpenDeals) || maxOpenDeals < 0) {
      throw new Error("maxOpenDeals must be a non-negative integer or null.");
    }
    maxOpenDeals = Math.floor(maxOpenDeals);
  }

  const onPtoUntil =
    input.onPtoUntil === undefined
      ? undefined
      : parseOnPtoDate(input.onPtoUntil);

  const country =
    input.country === undefined
      ? undefined
      : input.country?.trim()
        ? input.country.trim()
        : null;

  const row = await prisma.salesUserAssignmentProfile.upsert({
    where: {
      organizationId_userId: {
        organizationId: BigInt(input.organizationId),
        userId: BigInt(input.userId),
      },
    },
    create: {
      organizationId: BigInt(input.organizationId),
      userId: BigInt(input.userId),
      acceptingLeads: input.acceptingLeads ?? true,
      maxOpenDeals: maxOpenDeals ?? null,
      seniorityTier: tier ?? null,
      onPtoUntil: onPtoUntil ?? null,
      country: country ?? null,
    },
    update: {
      ...(input.acceptingLeads !== undefined
        ? { acceptingLeads: input.acceptingLeads }
        : {}),
      ...(maxOpenDeals !== undefined ? { maxOpenDeals } : {}),
      ...(tier !== undefined ? { seniorityTier: tier } : {}),
      ...(onPtoUntil !== undefined ? { onPtoUntil } : {}),
      ...(country !== undefined ? { country } : {}),
    },
  });

  return {
    userId: row.userId.toString(),
    acceptingLeads: row.acceptingLeads,
    maxOpenDeals: row.maxOpenDeals,
    seniorityTier: parseTier(row.seniorityTier),
    onPtoUntil: toDateOnly(row.onPtoUntil),
    country: row.country?.trim() || null,
  };
}
