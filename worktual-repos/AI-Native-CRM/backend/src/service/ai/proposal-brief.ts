/**
 * Post-meeting commercial drafts: proposal (+ optional linked quote).
 * Never auto-emails the customer. Salesperson is notified via CRM-BOT.
 */

import { Prisma } from "@prisma/client";
import { prisma } from "@/dao/db/prisma";
import { createContactActivity } from "@/dao/contacts/contact-activity-service";
import { createQuote } from "@/dao/sales/quote-service";
import { createDeal, updateDealStage } from "@/dao/sales/deal-service";
import { encodeNoteBody } from "@/lib/note-body";
import type { PostMeetingAnalysis } from "@/service/ai/post-meeting-analyze";
import type { SellerOrganization } from "@/service/ai/seller-org";
import { evaluateQuoteDiscountApproval } from "@/service/sales/quote-discount-approval";
import { notifyUsersViaCrmBot } from "@/service/email/notify-crm-bot";
import { runWithRequestUserId } from "@/service/account/request-context";

export type ProposalBrief = {
  version: 1;
  createdAt: string;
  seller: {
    companyName: string | null;
    industryType: string | null;
    businessType: string | null;
    websiteUrl: string | null;
  };
  customerBusinessSummary: string | null;
  requestedThemes: string[];
  narrative: string;
  openQuestions: string[];
  nextBestAction: string;
  activityId: string | null;
  dealId: string | null;
  proposalId: string | null;
  quoteId: string | null;
  pricingComplete: boolean;
};

export function buildProposalBrief(input: {
  analysis: PostMeetingAnalysis;
  seller: SellerOrganization | null;
  activityId: string | null;
  dealId: string | null;
}): ProposalBrief {
  const narrative =
    input.analysis.proposalNarrative?.trim() ||
    [
      "Proposal draft from post-meeting analysis.",
      input.analysis.customerBusinessSummary
        ? `Customer context: ${input.analysis.customerBusinessSummary.slice(0, 400)}`
        : null,
      input.analysis.requestedThemes.length
        ? `Themes: ${input.analysis.requestedThemes.join(", ")}`
        : null,
    ]
      .filter(Boolean)
      .join("\n\n");

  return {
    version: 1,
    createdAt: new Date().toISOString(),
    seller: {
      companyName: input.seller?.companyName ?? null,
      industryType: input.seller?.industryType ?? null,
      businessType: input.seller?.businessType ?? null,
      websiteUrl: input.seller?.websiteUrl ?? null,
    },
    customerBusinessSummary: input.analysis.customerBusinessSummary,
    requestedThemes: input.analysis.requestedThemes,
    narrative,
    openQuestions: input.analysis.openQuestions,
    nextBestAction: input.analysis.nextBestAction,
    activityId: input.activityId,
    dealId: input.dealId,
    proposalId: null,
    quoteId: null,
    pricingComplete: input.analysis.pricingCompleteForQuote,
  };
}

function escapeBriefHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

export function renderProposalBriefNoteHtml(
  brief: ProposalBrief,
  opts?: { quotePending?: boolean },
): string {
  const sections: string[] = [
    "<h3>Proposal draft ready</h3>",
    opts?.quotePending
      ? "<p><strong>Status</strong> — Proposal drafted. Quotation needs salesperson to complete pricing (CRM bot will not invent prices).</p>"
      : "<p><strong>Status</strong> — Draft saved. Review and send yourself when ready. Not emailed to the customer.</p>",
  ];

  const summary = brief.customerBusinessSummary?.trim() || null;
  const narrative = brief.narrative?.trim() || null;
  if (summary) {
    sections.push(
      "<h4>Customer situation</h4>",
      `<p>${escapeBriefHtml(summary)}</p>`,
    );
  }
  if (narrative) {
    sections.push(
      "<h4>Recommended approach</h4>",
      `<p>${escapeBriefHtml(narrative)}</p>`,
    );
  }
  if (brief.openQuestions.length) {
    sections.push(
      "<h4>Open questions</h4>",
      `<ul>${brief.openQuestions
        .map((q) => q.trim())
        .filter(Boolean)
        .map((q) => `<li>${escapeBriefHtml(q)}</li>`)
        .join("")}</ul>`,
    );
  }
  return sections.join("");
}

async function matchProductId(
  productName: string,
  organizationId: string,
): Promise<{ productId: string | null; unitPrice: number | null }> {
  const products = await prisma.product.findMany({
    where: {
      organizationId,
      status: { not: "archived" },
    },
    select: { id: true, name: true, price: true },
    take: 200,
    orderBy: { name: "asc" },
  });
  const nm = productName.trim().toLowerCase();
  if (!nm || !products.length) return { productId: null, unitPrice: null };
  const exact = products.find((p) => p.name.toLowerCase() === nm);
  if (exact) {
    return {
      productId: exact.id,
      unitPrice: exact.price != null ? Number(exact.price) : null,
    };
  }
  const contained = products.filter(
    (p) =>
      p.name.toLowerCase().includes(nm) || nm.includes(p.name.toLowerCase()),
  );
  if (contained.length === 1) {
    return {
      productId: contained[0]!.id,
      unitPrice:
        contained[0]!.price != null ? Number(contained[0]!.price) : null,
    };
  }
  return { productId: null, unitPrice: null };
}

async function persistQuoteDraftFromMeeting(input: {
  dealId: string;
  organizationId: string;
  ownerUserId: string | null;
  analysis: PostMeetingAnalysis;
  brief: ProposalBrief;
  proposalId?: string | null;
}): Promise<string | null> {
  const hints = [
    ...(input.analysis.quoteProductHints ?? []),
    ...input.brief.requestedThemes,
    ...input.analysis.quoteLines.map((l) => l.productName),
  ].filter(Boolean);

  const uniqueHints = [...new Set(hints.map((h) => h.trim()).filter(Boolean))];
  const lineSeeds =
    input.analysis.pricingCompleteForQuote && input.analysis.quoteLines.length
      ? input.analysis.quoteLines.map((l) => ({
          productName: l.productName,
          productId: l.productId ?? null,
          quantity: l.quantity,
          unitPrice: l.unitPrice,
        }))
      : uniqueHints.map((name) => ({
          productName: name,
          productId: null as string | null,
          quantity: 1,
          unitPrice: 0,
        }));

  if (!lineSeeds.length) return null;

  const lines = [];
  for (const seed of lineSeeds) {
    const matched = await matchProductId(seed.productName, input.organizationId);
    const unitPrice =
      seed.unitPrice > 0
        ? seed.unitPrice
        : matched.unitPrice != null
          ? matched.unitPrice
          : 0;
    lines.push({
      productId: matched.productId || seed.productId || null,
      name: seed.productName,
      quantity: seed.quantity,
      unitPrice,
    });
  }

  if (!lines.length) return null;

  const discountPct = input.analysis.suggestedDiscountPct ?? 0;
  const quote = await createQuote({
    dealId: input.dealId,
    proposalId: input.proposalId ?? null,
    notes: input.analysis.pricingCompleteForQuote
      ? "Draft from post-meeting agent — review before sending."
      : "Draft from post-meeting agent — catalog pricing applied; review before sending.",
    createdByUserId: input.ownerUserId,
    organizationId: input.organizationId,
    discountPct,
    lines,
  });

  await evaluateQuoteDiscountApproval({
    quoteId: quote.id,
    organizationId: input.organizationId,
    discountPct: Number(quote.discountPct),
    previousApprovalStatus: quote.approvalStatus,
    lines: lines.map((l) => ({ productId: l.productId })),
    actorUserId: null,
    dealTitle: null,
    quoteNumber: quote.number,
  });

  return quote.id;
}

/** Ensure an open deal exists for proposal/quote (both require dealId). */
export async function ensureOpenDealForContact(input: {
  contactId: string;
  organizationId: string;
  ownerUserId: string | null;
  title: string;
  companyId: string | null;
  contactName: string | null;
  contactEmail: string | null;
}): Promise<string | null> {
  const existing = await prisma.deal.findFirst({
    where: {
      organizationId: input.organizationId,
      contactId: input.contactId,
      closedAt: null,
    },
    orderBy: { updatedAt: "desc" },
    select: { id: true },
  });
  if (existing) return existing.id;

  let resolved: { companyId: string; locationId: string } | null = null;
  try {
    resolved = await resolveCompanyLocationForOrg({
      organizationId: input.organizationId,
      companyId: input.companyId,
      contactId: input.contactId,
      contactName: input.contactName,
    });
  } catch (err) {
    console.error("resolveCompanyLocationForOrg failed", err);
  }
  if (!resolved) {
    console.error(
      "ensureOpenDealForContact: no company/location in org",
      input.organizationId,
      input.companyId,
    );
    return null;
  }

  try {
    const deal = await createDeal(
      {
        title: input.title.slice(0, 200) || "Post-meeting opportunity",
        stage: "propose",
        companyId: resolved.companyId,
        locationId: resolved.locationId,
        contactId: input.contactId,
        contactName: input.contactName,
        contactEmail: input.contactEmail,
        ownerUserId: input.ownerUserId,
        notes: "Auto-created from post-meeting proposal draft.",
      },
      {
        actorUserId: input.ownerUserId,
        organizationId: input.organizationId,
      },
    );
    return deal.id;
  } catch (err) {
    console.error("ensureOpenDealForContact failed", err);
    return null;
  }
}

/**
 * Deal company/location must live in the contact's organization. Contacts can
 * be linked to a same-named company in another tenant (data drift) — resolve or
 * create a location in the correct org so post-meeting drafts still land.
 */
async function resolveCompanyLocationForOrg(input: {
  organizationId: string;
  companyId: string | null;
  contactId: string;
  contactName: string | null;
}): Promise<{ companyId: string; locationId: string } | null> {
  const orgId = input.organizationId;

  const tryCompany = async (companyId: string) => {
    const company = await prisma.company.findUnique({
      where: { id: companyId },
      select: { id: true, name: true, organizationId: true },
    });
    if (!company) return null;

    if (String(company.organizationId) === orgId) {
      let location = await prisma.companyLocation.findFirst({
        where: { companyId: company.id, organizationId: orgId },
        orderBy: { createdAt: "asc" },
        select: { id: true },
      });
      if (!location) {
        location = await prisma.companyLocation.create({
          data: {
            companyId: company.id,
            organizationId: orgId,
            name: "Headquarters",
            type: "hq",
          },
          select: { id: true },
        });
      }
      return { companyId: company.id, locationId: location.id };
    }

    // Same name in the contact's tenant.
    const named = company.name?.trim();
    if (!named) return null;
    const sibling = await prisma.company.findFirst({
      where: {
        organizationId: orgId,
        name: { equals: named, mode: "insensitive" },
      },
      select: { id: true },
    });
    if (sibling) {
      let location = await prisma.companyLocation.findFirst({
        where: { companyId: sibling.id, organizationId: orgId },
        orderBy: { createdAt: "asc" },
        select: { id: true },
      });
      if (!location) {
        location = await prisma.companyLocation.create({
          data: {
            companyId: sibling.id,
            organizationId: orgId,
            name: "Headquarters",
            type: "hq",
          },
          select: { id: true },
        });
      }
      await prisma.contactProfile
        .updateMany({
          where: { accountContactId: input.contactId, organizationId: orgId },
          data: { companyId: sibling.id, locationId: location.id },
        })
        .catch((err) =>
          console.error("relink contact company to tenant org failed", err),
        );
      return { companyId: sibling.id, locationId: location.id };
    }

    const createNamed = async (companyName: string) => {
      const created = await prisma.company.create({
        data: {
          organizationId: orgId,
          name: companyName,
          locations: {
            create: {
              organizationId: orgId,
              name: "Headquarters",
              type: "hq",
            },
          },
        },
        select: {
          id: true,
          locations: { select: { id: true }, take: 1 },
        },
      });
      const locationId = created.locations[0]?.id;
      if (!locationId) return null;
      await prisma.contactProfile
        .updateMany({
          where: { accountContactId: input.contactId, organizationId: orgId },
          data: { companyId: created.id, locationId },
        })
        .catch((err) =>
          console.error("relink contact to new tenant company failed", err),
        );
      return { companyId: created.id, locationId };
    };

    try {
      return await createNamed(named);
    } catch (err) {
      // Race or legacy global unique — try tenant-scoped display name.
      console.error(
        "create tenant company failed; retrying with org suffix",
        named,
        orgId,
        err,
      );
      const suffixed = `${named} (${orgId})`.slice(0, 200);
      try {
        return await createNamed(suffixed);
      } catch (err2) {
        console.error("create tenant company with suffix failed", err2);
        return null;
      }
    }
  };

  if (input.companyId?.trim()) {
    const hit = await tryCompany(input.companyId.trim());
    if (hit) return hit;
  }

  // No usable company link — still open a deal under a contact-named shell account.
  const shellName =
    (input.contactName?.trim() || "Opportunity").slice(0, 180) + " (account)";
  try {
    const created = await prisma.company.create({
      data: {
        organizationId: orgId,
        name: shellName,
        locations: {
          create: {
            organizationId: orgId,
            name: "Headquarters",
            type: "hq",
          },
        },
      },
      select: {
        id: true,
        locations: { select: { id: true }, take: 1 },
      },
    });
    const locationId = created.locations[0]?.id;
    if (!locationId) return null;
    await prisma.contactProfile
      .updateMany({
        where: { accountContactId: input.contactId, organizationId: orgId },
        data: { companyId: created.id, locationId },
      })
      .catch((err) =>
        console.error("relink contact to shell company failed", err),
      );
    return { companyId: created.id, locationId };
  } catch (err) {
    console.error("shell company create failed", err);
    return null;
  }
}

/** Requirement brief for playbook-based proposal generation (post-meeting + regenerate). */
export function buildPostMeetingProposalRequirement(input: {
  contactName: string;
  brief: ProposalBrief;
  analysis: PostMeetingAnalysis;
  meetingTranscript?: string | null;
  proposalTitle: string;
}): string {
  const parts = [
    input.brief.narrative?.trim(),
    input.brief.customerBusinessSummary?.trim(),
    input.analysis.requestedThemes.length
      ? `Themes from meeting: ${input.analysis.requestedThemes.join(", ")}`
      : null,
    input.brief.openQuestions.length
      ? `Open questions:\n${input.brief.openQuestions.map((q) => `- ${q}`).join("\n")}`
      : null,
    input.meetingTranscript?.trim()
      ? `Meeting transcript:\n${input.meetingTranscript.trim().slice(0, 12000)}`
      : null,
  ].filter(Boolean);

  if (parts.join("\n\n").length >= 8) {
    return parts.join("\n\n");
  }
  return `Post-meeting proposal for ${input.contactName} — ${input.proposalTitle}.`;
}

export async function persistCommercialDrafts(input: {
  contactId: string;
  organizationId: string;
  ownerUserId: string | null;
  meetingActivityId: string;
  dealId: string | null;
  brief: ProposalBrief;
  analysis: PostMeetingAnalysis;
  contactName: string;
}): Promise<{
  brief: ProposalBrief;
  proposalId: string | null;
  quoteId: string | null;
  quotePending: boolean;
  dealId: string | null;
}> {
  const wantsProposal =
    input.analysis.wantsProposalDraft ??
    input.analysis.requirementsSufficientForProposal;
  const wantsQuote =
    input.analysis.wantsQuoteDraft ??
    input.analysis.pricingCompleteForQuote;
  const quotePending =
    wantsQuote &&
    !input.analysis.pricingCompleteForQuote &&
    !(input.analysis.quoteLines?.length > 0);

  const note = await createContactActivity(input.contactId, {
    type: quotePending ? "task" : "note",
    subject: !wantsProposal && wantsQuote
      ? "Quotation draft from meeting"
      : quotePending
        ? "Complete quotation from meeting"
        : wantsProposal && wantsQuote
          ? "Proposal and quote drafts ready"
          : "Proposal draft ready",
    body: encodeNoteBody({
      html: renderProposalBriefNoteHtml(input.brief, { quotePending }),
    }),
    createdByUserId: input.ownerUserId,
    ...(quotePending
      ? {
          taskStatus: "open" as const,
          assigneeUserId: input.ownerUserId,
          dueAt: new Date(Date.now() + 2 * 24 * 60 * 60 * 1000),
        }
      : {}),
  });

  const meeting = await prisma.contactActivity.findUnique({
    where: { id: input.meetingActivityId },
    select: { transcriptInsights: true },
  });
  const prior =
    meeting?.transcriptInsights &&
    typeof meeting.transcriptInsights === "object" &&
    !Array.isArray(meeting.transcriptInsights)
      ? (meeting.transcriptInsights as Record<string, unknown>)
      : {};

  let proposalId: string | null = null;
  let quoteId: string | null = null;
  let dealId = input.dealId;

  if (dealId) {
    try {
      await runWithRequestUserId(input.ownerUserId, async () => {
        const meetingRow = await prisma.contactActivity.findUnique({
          where: { id: input.meetingActivityId },
          select: { transcriptText: true, subject: true },
        });
        const meetingTranscript = meetingRow?.transcriptText?.trim() || null;

        if (wantsProposal) {
          const themeTitle =
            input.brief.requestedThemes[0] ||
            input.brief.seller.companyName ||
            "Meeting proposal";
          const proposalTitle = `Proposal – ${themeTitle}`.slice(0, 200);

          const productHint =
            input.brief.requestedThemes[0] ||
            input.analysis.quoteLines[0]?.productName ||
            input.analysis.quoteProductHints?.[0] ||
            null;

          const requirementText = buildPostMeetingProposalRequirement({
            contactName: input.contactName,
            brief: input.brief,
            analysis: input.analysis,
            meetingTranscript,
            proposalTitle,
          });

          if (requirementText.trim()) {
            await prisma.deal
              .update({
                where: { id: dealId! },
                data: { notes: requirementText.slice(0, 8000) },
              })
              .catch((err) =>
                console.error(
                  "post-meeting deal notes update failed",
                  dealId,
                  err,
                ),
              );
          }

          const { createProposalFromPlaybookCommand } = await import(
            "@/service/sales/proposal-from-playbook-commands"
          );
          const playbookResult = await createProposalFromPlaybookCommand({
            dealId: dealId!,
            requirementText,
            title: proposalTitle,
            productHint,
            playbookId: null,
            requirementSource: "meeting",
            sync: true,
          });

          if (!playbookResult.ok) {
            throw new Error(playbookResult.error);
          }

          proposalId = playbookResult.id;
          if (playbookResult.warnings?.length) {
            console.warn(
              "post-meeting proposal playbook warnings",
              dealId,
              playbookResult.warnings,
            );
          }
        }

        if (wantsQuote) {
          quoteId = await persistQuoteDraftFromMeeting({
            dealId: dealId!,
            organizationId: input.organizationId,
            ownerUserId: input.ownerUserId,
            analysis: input.analysis,
            brief: input.brief,
            proposalId,
          });
        }

        const deal = await prisma.deal.findUnique({
          where: { id: dealId! },
          select: { stage: true, closedAt: true },
        });
        if (
          deal &&
          !deal.closedAt &&
          (deal.stage === "qualification" || deal.stage === "discover")
        ) {
          await updateDealStage(dealId!, "propose");
        }
      });
    } catch (err) {
      console.error("persistCommercialDrafts documents failed", err);
    }
  }

  const brief: ProposalBrief = {
    ...input.brief,
    dealId,
    proposalId,
    quoteId,
    pricingComplete: !quotePending,
  };

  await prisma.contactActivity.update({
    where: { id: input.meetingActivityId },
    data: {
      transcriptInsights: {
        ...prior,
        postMeetingProcess: {
          ...(typeof prior.postMeetingProcess === "object" &&
          prior.postMeetingProcess &&
          !Array.isArray(prior.postMeetingProcess)
            ? (prior.postMeetingProcess as Record<string, unknown>)
            : {}),
          proposalBrief: brief,
          noteActivityId: note.id,
        },
      } as Prisma.InputJsonObject,
    },
  });

  return {
    brief,
    proposalId,
    quoteId,
    quotePending,
    dealId,
  };
}

/** Meeting narrative + transcript for proposal personalize / regenerate. */
export async function loadMeetingNotesForDeal(
  dealId: string,
): Promise<string | null> {
  const deal = await prisma.deal.findUnique({
    where: { id: dealId },
    select: { contactId: true, notes: true },
  });
  if (!deal?.contactId) return deal?.notes?.trim() || null;

  const meeting = await prisma.contactActivity.findFirst({
    where: {
      contactId: deal.contactId,
      transcriptText: { not: null },
    },
    orderBy: { updatedAt: "desc" },
    select: { transcriptText: true, transcriptInsights: true },
  });

  const parts: string[] = [];
  if (deal.notes?.trim()) parts.push(deal.notes.trim());

  if (meeting) {
    const insights =
      meeting.transcriptInsights &&
      typeof meeting.transcriptInsights === "object" &&
      !Array.isArray(meeting.transcriptInsights)
        ? (meeting.transcriptInsights as Record<string, unknown>)
        : null;
    const brief = (
      insights?.postMeetingProcess as Record<string, unknown> | undefined
    )?.proposalBrief as ProposalBrief | undefined;
    if (brief?.narrative?.trim()) parts.push(brief.narrative.trim());
    if (brief?.customerBusinessSummary?.trim()) {
      parts.push(brief.customerBusinessSummary.trim());
    }
    const transcript = meeting.transcriptText?.trim();
    if (transcript) {
      parts.push(
        `Meeting transcript (excerpt):\n${transcript.slice(0, 8000)}`,
      );
    }
  }

  const merged = parts.filter(Boolean).join("\n\n");
  return merged || null;
}

export async function notifySalesOfCommercialDraft(input: {
  organizationId: string;
  ownerUserId: string;
  contactId: string;
  contactName: string;
  proposalId: string | null;
  quoteId: string | null;
  quotePending: boolean;
  dealId: string | null;
}): Promise<void> {
  const href = input.quoteId
    ? `/sales/quotes/${input.quoteId}`
    : input.proposalId
      ? `/sales/proposals/${input.proposalId}`
      : input.dealId
        ? `/sales/${input.dealId}`
        : `/contact/${input.contactId}`;

  const title =
    !input.proposalId && input.quoteId
      ? `Quote draft ready: ${input.contactName}`
      : input.quotePending
        ? `Complete quotation: ${input.contactName}`
        : input.proposalId && input.quoteId
          ? `Proposal and quote drafts ready: ${input.contactName}`
          : `Proposal draft ready: ${input.contactName}`;
  const body =
    !input.proposalId && input.quoteId
      ? `A quotation draft with catalog pricing was created from the meeting with ${input.contactName}. Review and send yourself when ready. The customer was not emailed.`
      : input.quotePending
        ? `A proposal draft was created from the meeting with ${input.contactName}. Pricing was incomplete — complete the quotation yourself before sending. The customer was not emailed.`
        : input.proposalId && input.quoteId
          ? `Proposal and quotation drafts were created from the meeting with ${input.contactName}. Review and send yourself when ready. The customer was not emailed.`
          : `A proposal draft was created from the meeting with ${input.contactName}. Review and send yourself when ready. The customer was not emailed.`;

  await notifyUsersViaCrmBot({
    organizationId: input.organizationId,
    recipientUserIds: [input.ownerUserId],
    kind: input.quotePending
      ? "post_meeting_quote_incomplete"
      : "post_meeting_draft_ready",
    title,
    body,
    href,
    entityType: input.quoteId ? "quote" : "proposal",
    entityId: input.quoteId || input.proposalId,
    contactId: input.contactId,
    actorUserId: input.ownerUserId,
  });
}

/** @deprecated No customer auto-send from agents. Kept as stub for imports. */
export async function sendProposalEmail(_input: {
  ownerUserId: string;
  toEmail: string;
  contactName: string;
  brief: ProposalBrief;
}): Promise<{ ok: true } | { ok: false; error: string }> {
  return {
    ok: false,
    error:
      "Proposal/quote drafts are never auto-emailed. Salesperson must send manually.",
  };
}
