import { createHash } from "node:crypto";
import { canEditDeals } from "@/service/auth/rbac";
import {
  getCurrentOrganizationId,
  requireRole,
} from "@/service/auth/require-role";
import { getServerUserId } from "@/service/account/session-cookie";
import { assertRecordAccess } from "@/service/auth/ownership-scope";
import { getDeal } from "@/dao/sales/deal-service";
import { createProposal } from "@/dao/sales/proposal-service";
import { prisma } from "@/dao/db/prisma";
import { loadMeetingNotesForDeal } from "@/service/ai/proposal-brief";
import { listApprovedPlaybooks } from "@/dao/ai/proposal-corpus-store";
import {
  createProposalGenerationRun,
  findActiveRunByHash,
  getProposalGenerationRun,
  getRunByProposalId,
  markProposalGenerationRun,
} from "@/dao/sales/proposal-generation-run";
import {
  hashProposalGenerateInput,
  isProposalPipelineV2Enabled,
} from "@/lib/proposal-pipeline-v2";
import { processProposalGenerationTick } from "@/service/sales/proposal-run-worker";

async function assertDealAccess(dealId: string) {
  const deal = await getDeal(dealId);
  if (!deal) throw new Error("Deal not found.");
  await assertRecordAccess(deal.ownerUserId);
  return deal;
}

export function mapProposalRunView(run: {
  id: string;
  status: string;
  proposalId: string | null;
  dealId: string;
  error: unknown;
  pricingIssues: unknown;
  outline: unknown;
  dealPlan: unknown;
  qaReport: unknown;
  leaves?: Array<{
    leafKey: string;
    title: string;
    status: string;
    errorClass: string | null;
  }>;
}) {
  const leaves = run.leaves ?? [];
  const done = leaves.filter((l) => l.status === "done").length;
  return {
    id: run.id,
    status: run.status,
    proposalId: run.proposalId,
    dealId: run.dealId,
    progress: {
      done,
      total: leaves.length,
      label:
        leaves.length > 0
          ? `${done} of ${leaves.length} sections written`
          : run.status,
    },
    pricingIssues: run.pricingIssues,
    outline: run.outline,
    plan: run.dealPlan,
    qaReport: run.qaReport,
    error: run.error,
    leaves,
  };
}

export async function enqueueProposalGenerationRun(input: {
  dealId: string;
  requirementText: string;
  title?: string | null;
  playbookId?: string | null;
  productIds?: string[] | null;
  productHint?: string | null;
  requirementPdfBase64?: string | null;
  requirementFilename?: string | null;
  replaceProposalId?: string | null;
  requirementSource?: "meeting" | "brd" | "meeting+brd" | "manual";
}) {
  await requireRole(canEditDeals, "You cannot create proposals.");
  const deal = await assertDealAccess(input.dealId);
  const orgId = await getCurrentOrganizationId();
  if (!isProposalPipelineV2Enabled(orgId)) {
    return { ok: false as const, error: "Proposal pipeline V2 is off." };
  }
  const userId = await getServerUserId();
  const approved = await listApprovedPlaybooks(orgId);
  if (approved.length === 0) {
    return {
      ok: false as const,
      error:
        "No learned proposal patterns yet. Upload historical proposals in Configuration → Proposal patterns.",
    };
  }
  const hasInline =
    (input.requirementText || "").trim().length >= 8 ||
    Boolean(input.requirementPdfBase64?.trim()) ||
    Boolean(input.replaceProposalId);
  let hasRequirement = hasInline;
  if (!hasRequirement) {
    const meetingPeek = await loadMeetingNotesForDeal(input.dealId);
    hasRequirement = Boolean(meetingPeek?.trim());
  }
  if (!hasRequirement) {
    return {
      ok: false as const,
      error: "Provide a BRD, meeting notes on this deal, or a requirement brief.",
    };
  }

  const inputHash = hashProposalGenerateInput({
    dealId: input.dealId,
    requirementText: [
      input.requirementText,
      input.requirementFilename,
      input.requirementPdfBase64 ? "pdf" : "",
    ].join("\n"),
    playbookId: input.playbookId,
  });
  const existing = await findActiveRunByHash(orgId, inputHash, input.dealId);
  if (existing?.status === "completed" && existing.proposalId) {
    return {
      ok: true as const,
      id: existing.proposalId,
      runId: existing.id,
      reused: true,
      status: "drafting" as const,
    };
  }
  if (existing && existing.status !== "failed" && existing.status !== "completed") {
    return {
      ok: true as const,
      id: existing.proposalId || "",
      runId: existing.id,
      status: "generating" as const,
    };
  }

  const replaceId = input.replaceProposalId?.trim() || null;
  let proposalId = replaceId;
  if (replaceId) {
    await prisma.proposal.update({
      where: { id: replaceId },
      data: { approvalStatus: "generating" },
    });
  } else {
    const stub = await createProposal({
      dealId: input.dealId,
      title:
        (input.title || "").trim() ||
        `Proposal for ${deal.company?.name || "customer"}`,
      summary: "Generating proposal…",
      customerName: deal.company?.name ?? null,
      sections: [],
      createdByUserId: userId,
      organizationId: orgId,
      approvalStatus: "generating",
    });
    proposalId = stub.id;
  }

  const run = await createProposalGenerationRun({
    organizationId: orgId,
    dealId: input.dealId,
    proposalId: proposalId!,
      actorUserId: userId != null ? String(userId) : null,
    inputHash,
    requirementText: input.requirementText,
    playbookId: input.playbookId,
    inputJson: {
      schemaVersion: 1,
      dealId: input.dealId,
      requirementText: input.requirementText,
      title: input.title ?? null,
      playbookId: input.playbookId ?? null,
      productIds: input.productIds ?? null,
      productHint: input.productHint ?? null,
      requirementPdfBase64: input.requirementPdfBase64 ?? null,
      requirementFilename: input.requirementFilename ?? null,
      requirementSource: input.requirementSource ?? null,
    },
  });
  void processProposalGenerationTick();
  return {
    ok: true as const,
    id: proposalId!,
    runId: run.id,
    status: "generating" as const,
  };
}

export async function getProposalGenerationRunCommand(runId: string) {
  await requireRole(canEditDeals, "You cannot view proposals.");
  const orgId = await getCurrentOrganizationId();
  const run = await getProposalGenerationRun(runId, orgId);
  if (!run) return { ok: false as const, error: "Run not found." };
  return { ok: true as const, run: mapProposalRunView(run) };
}

export async function getProposalGenerationRunForProposalCommand(
  proposalId: string,
) {
  const orgId = await getCurrentOrganizationId();
  const run = await getRunByProposalId(proposalId, orgId);
  if (!run) return { ok: false as const, error: "Run not found." };
  return { ok: true as const, run: mapProposalRunView(run) };
}

export async function retryProposalGenerationRunCommand(runId: string) {
  await requireRole(canEditDeals, "You cannot create proposals.");
  const orgId = await getCurrentOrganizationId();
  const run = await getProposalGenerationRun(runId, orgId);
  if (!run) return { ok: false as const, error: "Run not found." };
  if (run.status !== "failed") {
    return { ok: false as const, error: "Only failed runs can be retried." };
  }
  if (run.proposalId) {
    await prisma.proposal.update({
      where: { id: run.proposalId },
      data: { approvalStatus: "generating", summary: "Generating proposal…" },
    });
  }
  await markProposalGenerationRun(run.id, {
    status: "queued",
    finishedAt: null,
    error: { set: null },
    heartbeatAt: new Date(),
  });
  void processProposalGenerationTick();
  return { ok: true as const, id: run.proposalId, runId: run.id };
}

export function stableInputHashForTests(text: string) {
  return createHash("sha256").update(text).digest("hex").slice(0, 8);
}
