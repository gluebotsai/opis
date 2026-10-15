/**
 * DAO for proposal corpus batches, items, pairs, jobs, and playbooks.
 */

import { prisma } from "@/dao/db/prisma";
import { nextContentPlaybookVersion } from "@/lib/proposal-content-playbook";
import {
  Prisma,
  type ProposalCorpusBatchStatus,
  type ProposalCorpusItemKind,
  type ProposalCorpusItemStatus,
  type ProposalCorpusJobStatus,
  type ProposalPlaybookStatus,
} from "@prisma/client";

function oid(organizationId: string | bigint): bigint {
  return typeof organizationId === "bigint"
    ? organizationId
    : BigInt(organizationId);
}

export type CreateBatchInput = {
  organizationId: string;
  createdByUserId: string;
  name?: string | null;
};

export async function createCorpusBatch(input: CreateBatchInput) {
  return prisma.proposalCorpusBatch.create({
    data: {
      organizationId: oid(input.organizationId),
      createdByUserId: BigInt(input.createdByUserId),
      name: input.name?.trim() || null,
      status: "uploading",
    },
  });
}

export async function getCorpusBatch(id: string, organizationId: string) {
  return prisma.proposalCorpusBatch.findFirst({
    where: { id, organizationId: oid(organizationId) },
    include: {
      items: { orderBy: { createdAt: "asc" } },
      pairs: true,
      jobs: { orderBy: { createdAt: "desc" }, take: 1 },
      playbooks: { orderBy: { createdAt: "desc" }, take: 12 },
    },
  });
}

export async function listCorpusBatches(organizationId: string, take = 50) {
  return prisma.proposalCorpusBatch.findMany({
    where: { organizationId: oid(organizationId) },
    orderBy: { createdAt: "desc" },
    take,
    include: {
      _count: { select: { items: true, playbooks: true } },
      jobs: { orderBy: { createdAt: "desc" }, take: 1 },
      items: {
        orderBy: { createdAt: "asc" },
        select: { id: true, kind: true, filename: true, status: true },
      },
    },
  });
}

export async function updateCorpusBatch(
  id: string,
  data: {
    status?: ProposalCorpusBatchStatus;
    lastError?: string | null;
    resultSummary?: Prisma.InputJsonValue | null;
    completedAt?: Date | null;
    name?: string | null;
  },
) {
  const patch: Prisma.ProposalCorpusBatchUpdateInput = {};
  if (data.status !== undefined) patch.status = data.status;
  if (data.lastError !== undefined) patch.lastError = data.lastError;
  if (data.resultSummary !== undefined) {
    patch.resultSummary =
      data.resultSummary === null
        ? { set: null }
        : (data.resultSummary as Prisma.InputJsonValue);
  }
  if (data.completedAt !== undefined) patch.completedAt = data.completedAt;
  if (data.name !== undefined) patch.name = data.name;
  return prisma.proposalCorpusBatch.update({ where: { id }, data: patch });
}

export async function deleteCorpusBatch(id: string, organizationId: string) {
  const existing = await prisma.proposalCorpusBatch.findFirst({
    where: { id, organizationId: oid(organizationId) },
    select: { id: true },
  });
  if (!existing) return null;
  await prisma.proposalCorpusBatch.delete({ where: { id } });
  return existing;
}

/** Wipe learned extracts + playbooks for one tenant. Generated proposals are left in place. */
export async function deleteProposalPatternsForOrg(organizationId: string) {
  const org = oid(organizationId);
  const batches = await prisma.proposalCorpusBatch.findMany({
    where: { organizationId: org },
    select: { id: true },
  });
  const playbooks = await prisma.proposalPlaybook.deleteMany({
    where: { organizationId: org },
  });
  const contentPlaybooks = await prisma.proposalContentPlaybook.deleteMany({
    where: { organizationId: org },
  });
  const deletedBatches = await prisma.proposalCorpusBatch.deleteMany({
    where: { organizationId: org },
  });
  return {
    batchIds: batches.map((row) => row.id),
    batchCount: deletedBatches.count,
    playbookCount: playbooks.count,
    contentPlaybookCount: contentPlaybooks.count,
  };
}

export async function createCorpusItem(input: {
  batchId: string;
  organizationId: string;
  kind: ProposalCorpusItemKind;
  storagePath: string;
  filename: string;
  mime?: string | null;
  sha256?: string | null;
  pairSlot?: number;
}) {
  return prisma.proposalCorpusItem.create({
    data: {
      batchId: input.batchId,
      organizationId: oid(input.organizationId),
      kind: input.kind,
      pairSlot: Number.isFinite(input.pairSlot) ? Number(input.pairSlot) : 0,
      storagePath: input.storagePath,
      filename: input.filename,
      mime: input.mime ?? null,
      sha256: input.sha256 ?? null,
      status: "pending",
    },
  });
}

export async function updateCorpusItem(
  id: string,
  data: {
    status?: ProposalCorpusItemStatus;
    pageCount?: number | null;
    extractJson?: Prisma.InputJsonValue | null;
    lastError?: string | null;
    storagePath?: string;
    sha256?: string | null;
  },
) {
  const patch: Prisma.ProposalCorpusItemUpdateInput = {};
  if (data.status !== undefined) patch.status = data.status;
  if (data.pageCount !== undefined) patch.pageCount = data.pageCount;
  if (data.extractJson !== undefined) {
    patch.extractJson =
      data.extractJson === null
        ? { set: null }
        : (data.extractJson as Prisma.InputJsonValue);
  }
  if (data.lastError !== undefined) patch.lastError = data.lastError;
  if (data.storagePath !== undefined) patch.storagePath = data.storagePath;
  if (data.sha256 !== undefined) patch.sha256 = data.sha256;
  return prisma.proposalCorpusItem.update({ where: { id }, data: patch });
}

export async function listCorpusItems(batchId: string) {
  return prisma.proposalCorpusItem.findMany({
    where: { batchId },
    orderBy: { createdAt: "asc" },
  });
}

export async function replaceCorpusPairs(
  batchId: string,
  organizationId: string,
  pairs: Array<{
    requirementItemId: string;
    proposalItemId: string;
    confidence?: number | null;
    gapsJson?: Prisma.InputJsonValue | null;
    pairingSource?: string;
    isVisualMaster?: boolean;
  }>,
) {
  const deduplicated = new Map<string, (typeof pairs)[number]>();
  for (const pair of pairs) {
    const key = `${pair.requirementItemId}:${pair.proposalItemId}`;
    const existing = deduplicated.get(key);
    if (
      !existing ||
      Number(pair.confidence ?? 0) > Number(existing.confidence ?? 0)
    ) {
      deduplicated.set(key, pair);
    }
  }
  const org = oid(organizationId);
  const uniquePairs = [...deduplicated.values()];
  return prisma.$transaction(async (tx) => {
    const existing = await tx.proposalCorpusPair.findMany({ where: { batchId } });
    const byKey = new Map(
      existing.map((row) => [
        `${row.requirementItemId}:${row.proposalItemId}`,
        row,
      ]),
    );
    const keep = new Set<string>();
    for (const p of uniquePairs) {
      const key = `${p.requirementItemId}:${p.proposalItemId}`;
      keep.add(key);
      const gaps =
        p.gapsJson === null || p.gapsJson === undefined
          ? undefined
          : (p.gapsJson as Prisma.InputJsonValue);
      const current = byKey.get(key);
      if (current) {
        await tx.proposalCorpusPair.update({
          where: { id: current.id },
          data: {
            confidence: p.confidence ?? null,
            pairingSource: p.pairingSource || "user_explicit",
            isVisualMaster: Boolean(p.isVisualMaster),
            gapsJson: gaps,
          },
        });
      } else {
        await tx.proposalCorpusPair.create({
          data: {
            batchId,
            organizationId: org,
            requirementItemId: p.requirementItemId,
            proposalItemId: p.proposalItemId,
            confidence: p.confidence ?? null,
            pairingSource: p.pairingSource || "user_explicit",
            isVisualMaster: Boolean(p.isVisualMaster),
            gapsJson: gaps,
          },
        });
      }
    }
    const staleIds = existing
      .filter(
        (row) => !keep.has(`${row.requirementItemId}:${row.proposalItemId}`),
      )
      .map((row) => row.id);
    if (staleIds.length > 0) {
      await tx.proposalCorpusPair.deleteMany({
        where: { id: { in: staleIds } },
      });
    }
    return tx.proposalCorpusPair.findMany({ where: { batchId } });
  });
}

export async function listCorpusPairs(batchId: string) {
  return prisma.proposalCorpusPair.findMany({
    where: { batchId },
    orderBy: { createdAt: "asc" },
  });
}

export async function listCorpusPairsForOrg(organizationId: string) {
  return prisma.proposalCorpusPair.findMany({
    where: { organizationId: oid(organizationId) },
    orderBy: { createdAt: "asc" },
  });
}

export async function createCorpusJob(input: {
  batchId: string;
  organizationId: string;
}) {
  return prisma.proposalCorpusJob.create({
    data: {
      batchId: input.batchId,
      organizationId: oid(input.organizationId),
      status: "pending",
      stage: "pending",
    },
  });
}

export async function getCorpusJob(id: string) {
  return prisma.proposalCorpusJob.findUnique({
    where: { id },
    include: { batch: { include: { items: true } } },
  });
}

export async function claimCorpusJob(id: string) {
  const job = await prisma.proposalCorpusJob.findUnique({ where: { id } });
  if (!job) return null;
  const resumable = new Set([
    "pending",
    "failed",
    "ingesting",
    "structuring",
    "pairing",
    "synthesizing",
  ]);
  if (!resumable.has(job.status)) return null;
  if (job.attempts >= job.maxAttempts && job.status === "failed") return null;
  return prisma.proposalCorpusJob.update({
    where: { id },
    data: {
      attempts: { increment: 1 },
      status: "ingesting",
      stage: "ingesting",
      lastError: null,
    },
    include: { batch: { include: { items: true } } },
  });
}

export async function updateCorpusJob(
  id: string,
  data: {
    status?: ProposalCorpusJobStatus;
    stage?: string;
    lastError?: string | null;
    resultSummary?: Prisma.InputJsonValue | null;
    completedAt?: Date | null;
  },
) {
  const patch: Prisma.ProposalCorpusJobUpdateInput = {};
  if (data.status !== undefined) patch.status = data.status;
  if (data.stage !== undefined) patch.stage = data.stage;
  if (data.lastError !== undefined) patch.lastError = data.lastError;
  if (data.resultSummary !== undefined) {
    patch.resultSummary =
      data.resultSummary === null
        ? { set: null }
        : (data.resultSummary as Prisma.InputJsonValue);
  }
  if (data.completedAt !== undefined) patch.completedAt = data.completedAt;
  return prisma.proposalCorpusJob.update({ where: { id }, data: patch });
}

export async function createPlaybook(input: {
  organizationId: string;
  sourceBatchId?: string | null;
  contentPlaybookId?: string | null;
  name: string;
  tagsJson?: Prisma.InputJsonValue | null;
  sectionsJson: Prisma.InputJsonValue;
  blueprint?: Prisma.InputJsonValue | null;
  assets?: Prisma.InputJsonValue | null;
  sectionLibraryJson?: Prisma.InputJsonValue | null;
  status?: ProposalPlaybookStatus;
}) {
  return prisma.proposalPlaybook.create({
    data: {
      organizationId: oid(input.organizationId),
      sourceBatchId: input.sourceBatchId ?? null,
      contentPlaybookId: input.contentPlaybookId ?? null,
      name: input.name,
      tagsJson:
        input.tagsJson == null
          ? undefined
          : (input.tagsJson as Prisma.InputJsonValue),
      sectionsJson: input.sectionsJson as Prisma.InputJsonValue,
      blueprint:
        input.blueprint == null
          ? undefined
          : (input.blueprint as Prisma.InputJsonValue),
      assets:
        input.assets == null
          ? undefined
          : (input.assets as Prisma.InputJsonValue),
      sectionLibraryJson:
        input.sectionLibraryJson == null
          ? undefined
          : (input.sectionLibraryJson as Prisma.InputJsonValue),
      status: input.status ?? "approved",
      approvedAt:
        (input.status ?? "approved") === "approved" ? new Date() : undefined,
    },
  });
}

export async function listPlaybooks(
  organizationId: string,
  opts?: { status?: ProposalPlaybookStatus },
) {
  return prisma.proposalPlaybook.findMany({
    where: {
      organizationId: oid(organizationId),
      ...(opts?.status ? { status: opts.status } : {}),
    },
    orderBy: { updatedAt: "desc" },
  });
}

export async function getPlaybook(id: string, organizationId: string) {
  return prisma.proposalPlaybook.findFirst({
    where: { id, organizationId: oid(organizationId) },
  });
}

export async function updatePlaybook(
  id: string,
  data: {
    status?: ProposalPlaybookStatus;
    name?: string;
    tagsJson?: Prisma.InputJsonValue | null;
    sectionsJson?: Prisma.InputJsonValue;
    blueprint?: Prisma.InputJsonValue | null;
    assets?: Prisma.InputJsonValue | null;
    approvedAt?: Date | null;
    approvedByUserId?: string | null;
  },
) {
  const patch: Prisma.ProposalPlaybookUpdateInput = {};
  if (data.status !== undefined) patch.status = data.status;
  if (data.name !== undefined) patch.name = data.name;
  if (data.tagsJson !== undefined) {
    patch.tagsJson =
      data.tagsJson === null
        ? { set: null }
        : (data.tagsJson as Prisma.InputJsonValue);
  }
  if (data.sectionsJson !== undefined) {
    patch.sectionsJson = data.sectionsJson as Prisma.InputJsonValue;
  }
  if (data.blueprint !== undefined) {
    patch.blueprint =
      data.blueprint === null
        ? { set: null }
        : (data.blueprint as Prisma.InputJsonValue);
  }
  if (data.assets !== undefined) {
    patch.assets =
      data.assets === null
        ? { set: null }
        : (data.assets as Prisma.InputJsonValue);
  }
  if (data.approvedAt !== undefined) patch.approvedAt = data.approvedAt;
  if (data.approvedByUserId !== undefined) {
    patch.approvedByUserId =
      data.approvedByUserId == null
        ? null
        : BigInt(data.approvedByUserId);
  }
  return prisma.proposalPlaybook.update({ where: { id }, data: patch });
}

export async function upsertCorpusCaseStudy(input: {
  organizationId: string;
  batchId: string;
  pairId: string;
  pairingConfidence: number;
  sectionAnalysis: Prisma.InputJsonValue;
  lengthAnalysis: Prisma.InputJsonValue;
}) {
  return prisma.proposalCorpusCaseStudy.upsert({
    where: { pairId: input.pairId },
    create: {
      organizationId: oid(input.organizationId),
      batchId: input.batchId,
      pairId: input.pairId,
      pairingConfidence: input.pairingConfidence,
      sectionAnalysis: input.sectionAnalysis,
      lengthAnalysis: input.lengthAnalysis,
    },
    update: {
      pairingConfidence: input.pairingConfidence,
      sectionAnalysis: input.sectionAnalysis,
      lengthAnalysis: input.lengthAnalysis,
    },
  });
}

export async function listCaseStudiesForOrg(organizationId: string) {
  return prisma.proposalCorpusCaseStudy.findMany({
    where: { organizationId: oid(organizationId) },
    orderBy: { createdAt: "asc" },
  });
}

export async function countCaseStudiesForOrg(organizationId: string) {
  return prisma.proposalCorpusCaseStudy.count({
    where: { organizationId: oid(organizationId) },
  });
}

export async function countCorpusItemsForOrg(organizationId: string) {
  return prisma.proposalCorpusItem.count({
    where: { organizationId: oid(organizationId) },
  });
}

export async function getLatestContentPlaybook(organizationId: string) {
  return prisma.proposalContentPlaybook.findFirst({
    where: { organizationId: oid(organizationId) },
    orderBy: { version: "desc" },
  });
}

export const getLatestContentPlaybookForOrg = getLatestContentPlaybook;

export async function getContentPlaybookById(id: string) {
  return prisma.proposalContentPlaybook.findUnique({ where: { id } });
}

export async function createContentPlaybookVersion(input: {
  organizationId: string;
  sectionSpecsJson: Prisma.InputJsonValue;
  lengthModelJson: Prisma.InputJsonValue;
  exemplarBankJson: Prisma.InputJsonValue;
  caseStudyCount: number;
  confidenceLevel: string;
  varianceLogJson?: Prisma.InputJsonValue | null;
}) {
  const org = oid(input.organizationId);
  const latest = await prisma.proposalContentPlaybook.findFirst({
    where: { organizationId: org },
    orderBy: { version: "desc" },
    select: { version: true },
  });
  return prisma.proposalContentPlaybook.create({
    data: {
      organizationId: org,
      version: nextContentPlaybookVersion(latest?.version),
      sectionSpecsJson: input.sectionSpecsJson,
      lengthModelJson: input.lengthModelJson,
      exemplarBankJson: input.exemplarBankJson,
      caseStudyCount: input.caseStudyCount,
      confidenceLevel: input.confidenceLevel,
      varianceLogJson:
        input.varianceLogJson == null
          ? undefined
          : input.varianceLogJson,
    },
  });
}

export const CONTENT_PLAYBOOK_SYNTHESIS_FLOOR = 3;
export const CONTENT_PLAYBOOK_HIGH_CONFIDENCE_FLOOR = 8;
export const PAIR_USE_ANYWAY_THRESHOLD = 0.3;

export function contentPlaybookConfidenceLevel(caseStudyCount: number): "low" | "high" {
  return caseStudyCount >= CONTENT_PLAYBOOK_HIGH_CONFIDENCE_FLOOR ? "high" : "low";
}

export async function listApprovedPlaybooks(organizationId: string) {
  // Only corpus-learned playbooks (with a source batch) are eligible for
  // auto-match. Orphan/legacy approvals without sourceBatchId are excluded so
  // generation cannot silently reuse stale designs.
  return prisma.proposalPlaybook.findMany({
    where: {
      organizationId: oid(organizationId),
      status: "approved",
      sourceBatchId: { not: null },
    },
    orderBy: { updatedAt: "desc" },
  });
}
