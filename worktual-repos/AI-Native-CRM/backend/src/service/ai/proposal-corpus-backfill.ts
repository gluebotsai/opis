/**
 * One-time backfill: case studies from existing on-disk pairs (confidence ≥ 0.65).
 * Does not re-freeze visual playbooks (contentPlaybookId stays null on old rows).
 */

import type { Prisma } from "@prisma/client";
import {
  CONTENT_PLAYBOOK_SYNTHESIS_FLOOR,
  contentPlaybookConfidenceLevel,
  createContentPlaybookVersion,
  getLatestContentPlaybook,
  listCaseStudiesForOrg,
  upsertCorpusCaseStudy,
} from "@/dao/ai/proposal-corpus-store";
import { prisma } from "@/dao/db/prisma";
import { readCorpusFile } from "@/lib/proposal-corpus-storage";
import {
  LEGACY_AUTO_CONFIDENCE_FLOOR,
  pairingSourceForBackfill,
  measureProposalLength,
  overlayMeasuredLengthAnalysis,
  sectionBodiesFromUnknown,
  canonicalizeSectionAnalysis,
  canonicalizeSectionSpecs,
} from "@/lib/proposal-content-playbook";
import {
  AI_SERVICE_JOB_TIMEOUT_MS,
  callAiServiceAgent,
} from "@/service/ai/ai-service-client";
import { loadSellerOrganization } from "@/service/ai/seller-org";

const TIMEOUT_MS = Math.max(AI_SERVICE_JOB_TIMEOUT_MS, 180_000);

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

export async function backfillProposalCorpusCaseStudies(opts?: {
  organizationId?: string;
}): Promise<{
  pairsScanned: number;
  caseStudiesWritten: number;
  orgsSynthesized: string[];
  skipped: number;
}> {
  const where = {
    confidence: { gte: LEGACY_AUTO_CONFIDENCE_FLOOR },
    ...(opts?.organizationId
      ? { organizationId: BigInt(opts.organizationId) }
      : {}),
  };
  const pairs = await prisma.proposalCorpusPair.findMany({
    where,
    include: {
      requirementItem: true,
      proposalItem: true,
      caseStudies: { select: { id: true } },
    },
    orderBy: { createdAt: "asc" },
  });

  let written = 0;
  let skipped = 0;
  const touchedOrgs = new Set<string>();

  for (const pair of pairs) {
    await prisma.proposalCorpusPair.update({
      where: { id: pair.id },
      data: {
        pairingSource: pairingSourceForBackfill(pair.pairingSource),
      },
    });
    if (pair.caseStudies.length > 0) {
      skipped += 1;
      continue;
    }
    const req = pair.requirementItem;
    const prop = pair.proposalItem;
    let reqExtract = asRecord(req.extractJson);
    let propExtract = asRecord(prop.extractJson);
    if (!reqExtract.fullText && req.storagePath) {
      try {
        const buf = await readCorpusFile(req.storagePath);
        reqExtract = { ...reqExtract, fullText: buf.toString("utf8").slice(0, 20_000) };
      } catch {
        skipped += 1;
        continue;
      }
    }
    if (!propExtract.fullText && prop.storagePath) {
      try {
        const buf = await readCorpusFile(prop.storagePath);
        propExtract = { ...propExtract, fullText: buf.toString("utf8").slice(0, 20_000) };
      } catch {
        skipped += 1;
        continue;
      }
    }
    const orgId = String(pair.organizationId);
    const study = await callAiServiceAgent<{
      source?: string;
      sectionAnalysis?: unknown;
      lengthAnalysis?: unknown;
    }>(
      "proposal-corpus-case-study",
      {
        organizationId: orgId,
        pairId: pair.id,
        requirement: {
          filename: req.filename,
          fullText: reqExtract.fullText ?? "",
          brd: reqExtract.brd ?? null,
        },
        proposal: {
          filename: prop.filename,
          fullText: propExtract.fullText ?? "",
          instance: propExtract.instance ?? null,
          sections: asRecord(propExtract.instance).sections ?? [],
          pageCount: prop.pageCount ?? null,
        },
      },
      { timeoutMs: TIMEOUT_MS },
    );
    if (study?.source !== "ai") {
      skipped += 1;
      continue;
    }
    const measured = measureProposalLength({
      requirementText: String(reqExtract.fullText ?? ""),
      proposalText: String(propExtract.fullText ?? ""),
      proposalPageCount: prop.pageCount ?? null,
      proposalSectionBodies: sectionBodiesFromUnknown(
        asRecord(propExtract.instance).sections ??
          (Array.isArray(propExtract.sections) ? propExtract.sections : []),
      ),
    });
    await upsertCorpusCaseStudy({
      organizationId: orgId,
      batchId: pair.batchId,
      pairId: pair.id,
      pairingConfidence: Number(pair.confidence ?? 0),
      sectionAnalysis: canonicalizeSectionAnalysis(
        study.sectionAnalysis ?? [],
      ) as Prisma.InputJsonValue,
      lengthAnalysis: overlayMeasuredLengthAnalysis(
        study.lengthAnalysis,
        measured,
      ) as Prisma.InputJsonValue,
    });
    written += 1;
    touchedOrgs.add(orgId);
  }

  const orgsSynthesized: string[] = [];
  for (const orgId of touchedOrgs) {
    const studies = await listCaseStudiesForOrg(orgId);
    if (studies.length < CONTENT_PLAYBOOK_SYNTHESIS_FLOOR) continue;
    const latest = await getLatestContentPlaybook(orgId);
    if (latest && latest.caseStudyCount >= studies.length) continue;
    const seller = await loadSellerOrganization(orgId);
    const synthesized = await callAiServiceAgent<{
      source?: string;
      sectionSpecs?: unknown;
      lengthModel?: unknown;
      exemplarBank?: unknown;
      varianceLog?: unknown;
    }>(
      "proposal-playbook-synthesize",
      {
        organizationId: orgId,
        organizationName: seller?.companyName ?? "Vendor",
        caseStudies: studies.map((row) => ({
          id: row.id,
          pairingConfidence: row.pairingConfidence,
          sectionAnalysis: row.sectionAnalysis,
          lengthAnalysis: row.lengthAnalysis,
        })),
      },
      { timeoutMs: TIMEOUT_MS },
    );
    if (synthesized?.source !== "ai" || !synthesized.sectionSpecs) continue;
    await createContentPlaybookVersion({
      organizationId: orgId,
      sectionSpecsJson: canonicalizeSectionSpecs(
        synthesized.sectionSpecs,
      ) as Prisma.InputJsonValue,
      lengthModelJson: (synthesized.lengthModel ?? {}) as Prisma.InputJsonValue,
      exemplarBankJson: (synthesized.exemplarBank ?? []) as Prisma.InputJsonValue,
      caseStudyCount: studies.length,
      confidenceLevel: contentPlaybookConfidenceLevel(studies.length),
      varianceLogJson: (synthesized.varianceLog ?? null) as Prisma.InputJsonValue,
    });
    orgsSynthesized.push(orgId);
  }

  return {
    pairsScanned: pairs.length,
    caseStudiesWritten: written,
    orgsSynthesized,
    skipped,
  };
}
