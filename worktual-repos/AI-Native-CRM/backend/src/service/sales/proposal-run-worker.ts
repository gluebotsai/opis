/**
 * In-house V2 generate worker. Claims ProposalGenerationRun rows and runs
 * the existing sync from-playbook writer. Legacy void-withUser path stays
 * for flag-off orgs.
 */

import { withUser } from "@/middlewares/auth";
import {
  claimQueuedProposalGenerationRun,
  heartbeatProposalGenerationRun,
  markProposalGenerationRun,
  reapStaleProposalGenerationRuns,
  upsertProposalGenerationLeaf,
} from "@/dao/sales/proposal-generation-run";
import { proposalRunStaleMs } from "@/lib/proposal-pipeline-v2";
import { createProposalFromPlaybookCommand } from "@/service/sales/proposal-from-playbook-commands";
import { prisma } from "@/dao/db/prisma";

let ticking = false;
let timer: ReturnType<typeof setInterval> | null = null;

type StoredInput = {
  dealId?: string;
  requirementText?: string;
  title?: string | null;
  playbookId?: string | null;
  productIds?: string[] | null;
  productHint?: string | null;
  requirementPdfBase64?: string | null;
  requirementFilename?: string | null;
  requirementSource?: "meeting" | "brd" | "meeting+brd" | "manual";
};

export async function processProposalGenerationTick(): Promise<number> {
  if (ticking) return 0;
  ticking = true;
  try {
    await reapStaleProposalGenerationRuns(proposalRunStaleMs());
    let n = 0;
    for (let i = 0; i < 2; i++) {
      const run = await claimQueuedProposalGenerationRun();
      if (!run) break;
      n += 1;
      const actor = run.actorUserId || null;
      if (run.proposalId) {
        const { markProposalGenerateInFlight } = await import(
          "@/dao/sales/proposal-service"
        );
        markProposalGenerateInFlight(run.proposalId);
      }
      const beat = setInterval(() => {
        void heartbeatProposalGenerationRun(run.id);
      }, 15_000);
      try {
        await withUser(actor, async () => {
          await upsertProposalGenerationLeaf({
            runId: run.id,
            leafKey: "document",
            title: "Proposal",
            sectionType: "document",
            status: "running",
          });
          const input = (run.inputJson || {}) as StoredInput;
          const result = await createProposalFromPlaybookCommand({
            dealId: String(input.dealId || run.dealId),
            requirementText: String(
              input.requirementText || run.requirementText || "",
            ),
            title: input.title,
            playbookId: input.playbookId || run.playbookId,
            productIds: input.productIds,
            productHint: input.productHint,
            requirementPdfBase64: input.requirementPdfBase64,
            requirementFilename: input.requirementFilename,
            requirementSource: input.requirementSource,
            replaceProposalId: run.proposalId || undefined,
            generationRunId: run.id,
            sync: true,
          });
          if (!result.ok) {
            await markProposalGenerationRun(run.id, {
              status: "failed",
              finishedAt: new Date(),
              error: {
                schemaVersion: 1,
                message: result.error,
              },
            });
            await upsertProposalGenerationLeaf({
              runId: run.id,
              leafKey: "document",
              status: "failed",
              errorClass: "other",
            });
            return;
          }
          await upsertProposalGenerationLeaf({
            runId: run.id,
            leafKey: "document",
            status: "done",
          });
          await markProposalGenerationRun(run.id, {
            status: "completed",
            finishedAt: new Date(),
            playbookId: result.playbookId,
          });
        });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        await markProposalGenerationRun(run.id, {
          status: "failed",
          finishedAt: new Date(),
          error: { schemaVersion: 1, message },
        }).catch(() => undefined);
        if (run.proposalId) {
          await prisma.proposal
            .update({
              where: { id: run.proposalId },
              data: {
                approvalStatus: "failed",
                summary: message.slice(0, 500),
              },
            })
            .catch(() => undefined);
        }
      } finally {
        clearInterval(beat);
        if (run.proposalId) {
          const { clearProposalGenerateInFlight } = await import(
            "@/dao/sales/proposal-service"
          );
          clearProposalGenerateInFlight(run.proposalId);
        }
      }
    }
    return n;
  } finally {
    ticking = false;
  }
}

export function startProposalGenerationWorker() {
  if (timer) return;
  timer = setInterval(() => {
    void processProposalGenerationTick();
  }, 3_000);
  void processProposalGenerationTick();
}

export function stopProposalGenerationWorker() {
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
}
