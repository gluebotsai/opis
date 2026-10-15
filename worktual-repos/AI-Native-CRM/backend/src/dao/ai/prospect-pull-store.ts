/**
 * Prospect pull jobs + candidates (chat multi-source lead discovery).
 */

import { randomBytes } from "node:crypto";
import { getPrismaClient } from "@/dao/db/prisma";
import { Prisma, type ProspectPullStatus } from "@prisma/client";
import type { ResearchProviderId } from "@/dao/ai/research-provider-config";
import { prospectIdentityKeys } from "@/lib/prospect-already-known";

export type ProspectCriteria = {
  industries?: string[];
  geos?: string[];
  sizeTiers?: string[];
  titles?: string[];
  technographics?: string[];
  productFitHint?: string | null;
  freeText?: string | null;
};

export type ProspectCandidateInput = {
  firstName?: string | null;
  lastName?: string | null;
  email?: string | null;
  phone?: string | null;
  title?: string | null;
  companyName?: string | null;
  companyDomain?: string | null;
  linkedinUrl?: string | null;
  industry?: string | null;
  employeeCount?: number | null;
  city?: string | null;
  country?: string | null;
  technographics?: string[] | null;
  sourcesFoundIn: ResearchProviderId[];
  qualifyReasons?: string[] | null;
  qualifyScore?: number | null;
  providerPayload?: Prisma.InputJsonValue | null;
  rank?: number | null;
  selected?: boolean;
};

export type ProspectPullJobRow = {
  id: string;
  organizationId: string;
  requestedByUserId: string;
  status: ProspectPullStatus;
  limitN: number;
  sourcesRequested: ResearchProviderId[];
  sourcesUsed: ResearchProviderId[] | null;
  criteria: ProspectCriteria;
  attempts: number;
  maxAttempts: number;
  lastError: string | null;
  resultSummary: Prisma.JsonValue | null;
  createdAt: Date;
  updatedAt: Date;
  completedAt: Date | null;
};

export type ProspectPullCandidateRow = {
  id: string;
  jobId: string;
  organizationId: string;
  rank: number | null;
  selected: boolean;
  firstName: string | null;
  lastName: string | null;
  email: string | null;
  phone: string | null;
  title: string | null;
  companyName: string | null;
  companyDomain: string | null;
  linkedinUrl: string | null;
  industry: string | null;
  employeeCount: number | null;
  city: string | null;
  country: string | null;
  technographics: Prisma.JsonValue | null;
  sourcesFoundIn: ResearchProviderId[];
  qualifyReasons: Prisma.JsonValue | null;
  qualifyScore: number | null;
  providerPayload: Prisma.JsonValue | null;
  importedContactId: string | null;
  createdAt: Date;
  updatedAt: Date;
};

function cuidLike(prefix: string): string {
  return `${prefix}${randomBytes(12).toString("hex")}`;
}

function asProviderList(raw: unknown): ResearchProviderId[] {
  if (!Array.isArray(raw)) return [];
  const allowed = new Set(["apollo", "zoominfo", "lusha", "builtwith"]);
  return raw
    .filter((x): x is string => typeof x === "string")
    .map((x) => x.toLowerCase())
    .filter((x): x is ResearchProviderId => allowed.has(x));
}

function asCriteria(raw: unknown): ProspectCriteria {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  const o = raw as Record<string, unknown>;
  const strArr = (v: unknown) =>
    Array.isArray(v)
      ? v.filter((x): x is string => typeof x === "string" && Boolean(x.trim()))
      : undefined;
  return {
    industries: strArr(o.industries),
    geos: strArr(o.geos),
    sizeTiers: strArr(o.sizeTiers),
    titles: strArr(o.titles),
    technographics: strArr(o.technographics),
    productFitHint:
      typeof o.productFitHint === "string" ? o.productFitHint : null,
    freeText: typeof o.freeText === "string" ? o.freeText : null,
  };
}

function mapJob(r: {
  id: string;
  organizationId: bigint | string;
  requestedByUserId: bigint | string;
  status: ProspectPullStatus;
  limitN: number;
  sourcesRequested: Prisma.JsonValue;
  sourcesUsed: Prisma.JsonValue | null;
  criteria: Prisma.JsonValue;
  attempts: number;
  maxAttempts: number;
  lastError: string | null;
  resultSummary: Prisma.JsonValue | null;
  createdAt: Date;
  updatedAt: Date;
  completedAt: Date | null;
}): ProspectPullJobRow {
  return {
    id: r.id,
    organizationId: String(r.organizationId),
    requestedByUserId: String(r.requestedByUserId),
    status: r.status,
    limitN: r.limitN,
    sourcesRequested: asProviderList(r.sourcesRequested),
    sourcesUsed: r.sourcesUsed == null ? null : asProviderList(r.sourcesUsed),
    criteria: asCriteria(r.criteria),
    attempts: r.attempts,
    maxAttempts: r.maxAttempts,
    lastError: r.lastError,
    resultSummary: r.resultSummary,
    createdAt: r.createdAt,
    updatedAt: r.updatedAt,
    completedAt: r.completedAt,
  };
}

function mapCandidate(r: {
  id: string;
  jobId: string;
  organizationId: bigint | string;
  rank: number | null;
  selected: boolean;
  firstName: string | null;
  lastName: string | null;
  email: string | null;
  phone: string | null;
  title: string | null;
  companyName: string | null;
  companyDomain: string | null;
  linkedinUrl: string | null;
  industry: string | null;
  employeeCount: number | null;
  city: string | null;
  country: string | null;
  technographics: Prisma.JsonValue | null;
  sourcesFoundIn: Prisma.JsonValue;
  qualifyReasons: Prisma.JsonValue | null;
  qualifyScore: number | null;
  providerPayload: Prisma.JsonValue | null;
  importedContactId: string | null;
  createdAt: Date;
  updatedAt: Date;
}): ProspectPullCandidateRow {
  return {
    id: r.id,
    jobId: r.jobId,
    organizationId: String(r.organizationId),
    rank: r.rank,
    selected: r.selected,
    firstName: r.firstName,
    lastName: r.lastName,
    email: r.email,
    phone: r.phone,
    title: r.title,
    companyName: r.companyName,
    companyDomain: r.companyDomain,
    linkedinUrl: r.linkedinUrl,
    industry: r.industry,
    employeeCount: r.employeeCount,
    city: r.city,
    country: r.country,
    technographics: r.technographics,
    sourcesFoundIn: asProviderList(r.sourcesFoundIn),
    qualifyReasons: r.qualifyReasons,
    qualifyScore: r.qualifyScore,
    providerPayload: r.providerPayload,
    importedContactId: r.importedContactId,
    createdAt: r.createdAt,
    updatedAt: r.updatedAt,
  };
}

export async function createProspectPullJob(input: {
  organizationId: string;
  requestedByUserId: string;
  limitN: number;
  sourcesRequested: ResearchProviderId[];
  criteria: ProspectCriteria;
}): Promise<ProspectPullJobRow> {
  const prisma = getPrismaClient();
  const limitN = Math.min(25, Math.max(1, Math.floor(input.limitN)));
  const row = await prisma.prospectPullJob.create({
    data: {
      id: cuidLike("ppj_"),
      organizationId: BigInt(input.organizationId),
      requestedByUserId: BigInt(input.requestedByUserId),
      status: "pending",
      limitN,
      sourcesRequested: input.sourcesRequested,
      criteria: input.criteria as Prisma.InputJsonValue,
    },
  });
  return mapJob(row);
}

export async function findProspectPullJob(
  jobId: string,
  organizationId?: string,
): Promise<ProspectPullJobRow | null> {
  const prisma = getPrismaClient();
  const row = await prisma.prospectPullJob.findFirst({
    where: {
      id: jobId,
      ...(organizationId
        ? { organizationId: BigInt(organizationId) }
        : {}),
    },
  });
  return row ? mapJob(row) : null;
}

/**
 * Atomically claim a job for processing. Returns null if another worker
 * already owns it (or it is terminal). Prevents double search→store races
 * that duplicated candidates when enqueue + poll both called process.
 */
export async function claimProspectPullJob(
  jobId: string,
): Promise<ProspectPullJobRow | null> {
  const prisma = getPrismaClient();
  const result = await prisma.prospectPullJob.updateMany({
    where: {
      id: jobId,
      status: { in: ["pending", "failed"] },
    },
    data: {
      status: "searching",
      attempts: { increment: 1 },
      lastError: null,
    },
  });
  if (result.count === 0) return null;
  return findProspectPullJob(jobId);
}

export async function updateProspectPullJob(
  jobId: string,
  data: {
    status?: ProspectPullStatus;
    sourcesUsed?: ResearchProviderId[] | null;
    attempts?: number;
    lastError?: string | null;
    resultSummary?: Prisma.InputJsonValue | null;
    completedAt?: Date | null;
  },
): Promise<ProspectPullJobRow | null> {
  const prisma = getPrismaClient();
  try {
    const row = await prisma.prospectPullJob.update({
      where: { id: jobId },
      data: {
        ...(data.status !== undefined ? { status: data.status } : {}),
        ...(data.sourcesUsed !== undefined
          ? {
              sourcesUsed:
                data.sourcesUsed == null
                  ? Prisma.JsonNull
                  : (data.sourcesUsed as Prisma.InputJsonValue),
            }
          : {}),
        ...(data.attempts !== undefined ? { attempts: data.attempts } : {}),
        ...(data.lastError !== undefined ? { lastError: data.lastError } : {}),
        ...(data.resultSummary !== undefined
          ? {
              resultSummary:
                data.resultSummary == null
                  ? Prisma.JsonNull
                  : data.resultSummary,
            }
          : {}),
        ...(data.completedAt !== undefined
          ? { completedAt: data.completedAt }
          : {}),
      },
    });
    return mapJob(row);
  } catch {
    return null;
  }
}

export async function replaceProspectPullCandidates(
  jobId: string,
  organizationId: string,
  candidates: ProspectCandidateInput[],
): Promise<ProspectPullCandidateRow[]> {
  const prisma = getPrismaClient();
  const oid = BigInt(organizationId);
  await prisma.prospectPullCandidate.deleteMany({ where: { jobId } });
  if (candidates.length === 0) return [];
  await prisma.prospectPullCandidate.createMany({
    data: candidates.map((c, i) => ({
      id: cuidLike("ppc_"),
      jobId,
      organizationId: oid,
      rank: c.rank ?? i + 1,
      selected: c.selected ?? true,
      firstName: c.firstName ?? null,
      lastName: c.lastName ?? null,
      email: c.email ?? null,
      phone: c.phone ?? null,
      title: c.title ?? null,
      companyName: c.companyName ?? null,
      companyDomain: c.companyDomain ?? null,
      linkedinUrl: c.linkedinUrl ?? null,
      industry: c.industry ?? null,
      employeeCount: c.employeeCount ?? null,
      city: c.city ?? null,
      country: c.country ?? null,
      technographics:
        c.technographics == null
          ? undefined
          : (c.technographics as Prisma.InputJsonValue),
      sourcesFoundIn: c.sourcesFoundIn as Prisma.InputJsonValue,
      qualifyReasons:
        c.qualifyReasons == null
          ? undefined
          : (c.qualifyReasons as Prisma.InputJsonValue),
      qualifyScore: c.qualifyScore ?? null,
      providerPayload: c.providerPayload ?? undefined,
    })),
  });
  return listProspectPullCandidates(jobId, organizationId);
}

export async function listProspectPullCandidates(
  jobId: string,
  organizationId: string,
): Promise<ProspectPullCandidateRow[]> {
  const prisma = getPrismaClient();
  const rows = await prisma.prospectPullCandidate.findMany({
    where: { jobId, organizationId: BigInt(organizationId) },
    orderBy: [{ rank: "asc" }, { createdAt: "asc" }],
  });
  return rows.map(mapCandidate);
}

export async function setProspectCandidateSelection(input: {
  jobId: string;
  organizationId: string;
  selectedIds: string[];
}): Promise<number> {
  const prisma = getPrismaClient();
  const oid = BigInt(input.organizationId);
  await prisma.prospectPullCandidate.updateMany({
    where: { jobId: input.jobId, organizationId: oid },
    data: { selected: false },
  });
  if (input.selectedIds.length === 0) return 0;
  const result = await prisma.prospectPullCandidate.updateMany({
    where: {
      jobId: input.jobId,
      organizationId: oid,
      id: { in: input.selectedIds },
    },
    data: { selected: true },
  });
  return result.count;
}

export async function markCandidateImported(input: {
  candidateId: string;
  organizationId: string;
  contactId: string;
}): Promise<void> {
  const prisma = getPrismaClient();
  await prisma.prospectPullCandidate.updateMany({
    where: {
      id: input.candidateId,
      organizationId: BigInt(input.organizationId),
    },
    data: { importedContactId: input.contactId },
  });
}

/** People already offered or imported, so the next pull can skip them. */
export async function listRecentProspectIdentityKeys(
  organizationId: string,
): Promise<Set<string>> {
  const prisma = getPrismaClient();
  const rows = await prisma.prospectPullCandidate.findMany({
    where: { organizationId: BigInt(organizationId) },
    orderBy: { createdAt: "desc" },
    take: 400,
    select: {
      email: true,
      firstName: true,
      lastName: true,
      companyName: true,
      providerPayload: true,
    },
  });
  const keys = new Set<string>();
  for (const row of rows) {
    for (const key of prospectIdentityKeys(row)) keys.add(key);
  }
  return keys;
}

export async function listProspectPullJobsPage(input: {
  organizationId: string;
  limit: number;
  cursor?: string | null;
  status?: ProspectPullStatus | null;
}): Promise<{ rows: ProspectPullJobRow[]; nextCursor: string | null }> {
  const prisma = getPrismaClient();
  const take = Math.min(50, Math.max(1, input.limit));
  const rows = await prisma.prospectPullJob.findMany({
    where: {
      organizationId: BigInt(input.organizationId),
      ...(input.status ? { status: input.status } : {}),
      ...(input.cursor
        ? { createdAt: { lt: new Date(input.cursor) } }
        : {}),
    },
    orderBy: { createdAt: "desc" },
    take: take + 1,
  });
  const page = rows.slice(0, take).map(mapJob);
  const next =
    rows.length > take
      ? page[page.length - 1]?.createdAt.toISOString() ?? null
      : null;
  return { rows: page, nextCursor: next };
}
