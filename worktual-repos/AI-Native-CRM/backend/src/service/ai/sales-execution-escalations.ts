/**
 * Scheduled sales execution escalations → sales managers / admins.
 * Wired from `/api/cron/lifecycle-stall` alongside lead-lifecycle-stall.
 */

import { prisma } from "@/dao/db/prisma";
import { notifySalesEscalation } from "@/service/ai/sales-escalation-notify";

const DAY_MS = 24 * 60 * 60_000;

function insightsFlag(
  raw: unknown,
  key: string,
): boolean {
  if (!raw || typeof raw !== "object") return false;
  return (raw as Record<string, unknown>)[key] === true;
}

async function listTenantOrganizationIds(): Promise<string[]> {
  const rows = await prisma.contactProfile.findMany({
    distinct: ["organizationId"],
    select: { organizationId: true },
  });
  return rows
    .map((r) => String(r.organizationId))
    .filter(Boolean);
}

/** Proposal requested in MOM but no proposal document 48+ hours later. */
async function escalateProposalFollowUpMissed(
  organizationId: string,
  limit: number,
): Promise<number> {
  const minAge = new Date(Date.now() - 48 * DAY_MS);
  const maxAge = new Date(Date.now() - 7 * DAY_MS);

  const meetings = await prisma.contactActivity.findMany({
    where: {
      organizationId: BigInt(organizationId),
      type: "meeting",
      momSentAt: { lte: minAge, gte: maxAge },
      transcriptText: { not: null },
    },
    orderBy: { momSentAt: "desc" },
    take: limit,
    select: {
      id: true,
      contactId: true,
      momSentAt: true,
      transcriptInsights: true,
      subject: true,
    },
  });

  let escalated = 0;
  for (const meeting of meetings) {
    if (!insightsFlag(meeting.transcriptInsights, "momProposalRequested")) {
      continue;
    }
    if (insightsFlag(meeting.transcriptInsights, "momProposalEscalated")) {
      continue;
    }

    const openDeal = await prisma.deal.findFirst({
      where: {
        organizationId: BigInt(organizationId),
        contactId: meeting.contactId,
        closedAt: null,
      },
      orderBy: { updatedAt: "desc" },
      select: {
        id: true,
        title: true,
        ownerUserId: true,
        proposals: { select: { id: true }, take: 1 },
      },
    });
    if (!openDeal || openDeal.proposals.length > 0) continue;

    const profile = await prisma.contactProfile.findFirst({
      where: { accountContactId: meeting.contactId },
      select: { notes: true },
    });
    const contactName = profile?.notes?.trim() || "Contact";

    await notifySalesEscalation({
      organizationId,
      kind: "proposal_follow_up_missed",
      title: `Proposal not sent: ${contactName}`,
      body: `The customer requested a proposal in the meeting recap (${meeting.subject}), but no proposal has been created after 48+ hours.`,
      href: openDeal.id
        ? `/sales/${openDeal.id}`
        : `/contact/${meeting.contactId}`,
      contactId: meeting.contactId,
      entityType: "contact_activity",
      entityId: meeting.id,
      ownerUserId: openDeal.ownerUserId ? String(openDeal.ownerUserId) : null,
      contactName,
      dealTitle: openDeal.title,
      nextStep: "Ensure the rep prepares and sends the proposal, or update the deal stage.",
      includeOwner: true,
      metadata: {
        activityId: meeting.id,
        dealId: openDeal.id,
        momSentAt: meeting.momSentAt?.toISOString() ?? null,
      },
    });

    const prior =
      (meeting.transcriptInsights as Record<string, unknown> | null) ?? {};
    await prisma.contactActivity.update({
      where: { id: meeting.id },
      data: {
        transcriptInsights: {
          ...prior,
          momProposalEscalated: true,
        },
      },
    });
    escalated += 1;
  }
  return escalated;
}

/** Replaced by the working-hours reminder cadence in lead-assignment-followup. */
async function escalateHotLeadSlaBreach(
  _organizationId: string,
  _limit: number,
): Promise<number> {
  return 0;
}

export async function processSalesExecutionEscalations(options?: {
  organizationId?: string | null;
  limit?: number;
}): Promise<{ proposalMissed: number; hotLeadSla: number }> {
  const limit = Math.min(100, Math.max(1, options?.limit ?? 30));
  if (options?.organizationId === undefined) {
    const orgIds = await listTenantOrganizationIds();
    let proposalMissed = 0;
    let hotLeadSla = 0;
    for (const organizationId of orgIds) {
      const r = await processSalesExecutionEscalations({
        organizationId,
        limit,
      });
      proposalMissed += r.proposalMissed;
      hotLeadSla += r.hotLeadSla;
    }
    return { proposalMissed, hotLeadSla };
  }

  const organizationId = String(options.organizationId);
  const [proposalMissed, hotLeadSla] = await Promise.all([
    escalateProposalFollowUpMissed(organizationId, limit),
    escalateHotLeadSlaBreach(organizationId, limit).catch((err) => {
      console.error("hotLeadSla escalation failed", organizationId, err);
      return 0;
    }),
  ]);
  return { proposalMissed, hotLeadSla };
}
