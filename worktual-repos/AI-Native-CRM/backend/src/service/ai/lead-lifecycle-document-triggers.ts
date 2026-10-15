/**
 * Lifecycle → document agent triggers (spec §10.5).
 * Lifecycle only enqueues drafts at pending_approval — never sends.
 */

import { prisma } from "@/dao/db/prisma";
import type { LifecycleContext } from "@/service/ai/lead-lifecycle-context";
import type { LifecycleDecision } from "@/service/ai/lead-lifecycle-decide";

export async function triggerDocumentAgentsAfterLifecycle(
  ctx: LifecycleContext,
  decision: LifecycleDecision,
): Promise<void> {
  if (!ctx.deal?.id) return;

  const dealId = ctx.deal.id;
  try {
    if (
      decision.action.kind === "deal_stage" &&
      decision.action.to === "propose"
    ) {
      const existing = await prisma.proposal.findFirst({
        where: { dealId, status: { in: ["draft", "shared"] } },
        select: { id: true },
      });
      if (!existing) {
        // Mark a placeholder approval row via raw note activity — full proposal
        // creation needs product lines; set deal note for rep.
        await prisma.$executeRawUnsafe(
          `
          UPDATE deals SET notes = CONCAT(COALESCE(notes,''), E'\\n[Lifecycle] Ready for proposal draft — pending human approval before send.'),
            updated_at = NOW()
          WHERE id = $1
          `,
          dealId,
        );
      } else {
        await prisma.proposal.updateMany({
          where: { id: existing.id, approvedAt: null },
          data: { approvalStatus: "pending_approval" },
        });
      }
    }

    if (
      (decision.action.kind === "deal_stage" &&
        decision.action.to === "negotiate") ||
      decision.action.kind === "quote_draft"
    ) {
      await prisma.quote.updateMany({
        where: {
          dealId,
          status: "draft",
          approvedAt: null,
        },
        data: { approvalStatus: "pending_approval" },
      });
    }

    if (decision.action.kind === "close_won") {
      await prisma.invoice.updateMany({
        where: {
          dealId,
          status: "draft",
          approvedAt: null,
        },
        data: { approvalStatus: "pending_approval" },
      });
    }
  } catch (err) {
    console.error("triggerDocumentAgentsAfterLifecycle failed", dealId, err);
  }
}
