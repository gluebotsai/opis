/**
 * Match inbound customer email to sent proposals/quotes (PROP-/QUOTE- refs or
 * latest-sent fallback) and apply accept/decline actions.
 */

import { prisma } from "@/dao/db/prisma";
import { acceptQuote } from "@/dao/sales/quote-service";
import { rejectQuote } from "@/dao/sales/quote-service";
import { updateProposal } from "@/dao/sales/proposal-service";
import type { LifecycleContext } from "@/service/ai/lead-lifecycle-context";
import type { ApplyOutcome } from "@/service/ai/lead-lifecycle-apply";
import {
  notifySalesCustomerDocumentDecision,
} from "@/service/email/commercial-notify";
import { createQuoteDraftFromAcceptedProposal } from "@/service/sales/quote-from-proposal";
import { notifyFinanceInvoicePendingApproval } from "@/service/email/commercial-notify";
import {
  isCustomerVoiceActivity,
  type SignalActivity,
} from "@/service/ai/lead-lifecycle-signals";

export type CommercialDocType = "proposal" | "quote";

export type CommercialDecision = "accept" | "decline";

const PROP_REF = /\b(PROP-\d+)\b/gi;
const QUOTE_REF = /\b(QUOTE-\d+)\b/gi;

const COMMERCIAL_ACCEPT =
  /\b(we accept|accepted the (proposal|quote)|approved the (proposal|quote)|happy to proceed|let'?s proceed|go ahead with the (proposal|quote|order)|(counter[- ]?)?signed the (contract|quote|agreement|proposal)|purchase order|po number|send (us )?the invoice)\b/i;

const COMMERCIAL_DECLINE =
  /\b(reject(ed|ing)?|declin(ed|ing)|not (accept|approv)(ing|ed)|cannot proceed with|won't proceed with|will not proceed with).{0,40}\b(proposal|quote|quotation)\b|\b(proposal|quote|quotation).{0,40}\b(reject(ed|ing)?|declin(ed|ing)|not acceptable)\b/i;

export function parseCommercialDocReferences(text: string): {
  proposalNumbers: string[];
  quoteNumbers: string[];
} {
  const proposalNumbers = new Set<string>();
  const quoteNumbers = new Set<string>();
  for (const m of text.matchAll(PROP_REF)) {
    if (m[1]) proposalNumbers.add(m[1].toUpperCase());
  }
  for (const m of text.matchAll(QUOTE_REF)) {
    if (m[1]) quoteNumbers.add(m[1].toUpperCase());
  }
  return {
    proposalNumbers: [...proposalNumbers],
    quoteNumbers: [...quoteNumbers],
  };
}

export function mergeCommercialDocReferences(
  ...parts: Array<{ proposalNumbers: string[]; quoteNumbers: string[] }>
): { proposalNumbers: string[]; quoteNumbers: string[] } {
  const proposalNumbers = new Set<string>();
  const quoteNumbers = new Set<string>();
  for (const part of parts) {
    for (const n of part.proposalNumbers) proposalNumbers.add(n);
    for (const n of part.quoteNumbers) quoteNumbers.add(n);
  }
  return {
    proposalNumbers: [...proposalNumbers],
    quoteNumbers: [...quoteNumbers],
  };
}

/** Parse PROP-/QUOTE- numbers from one or more email subjects (thread send rows). */
export function parseCommercialRefsFromSubjects(subjects: string[]): {
  proposalNumbers: string[];
  quoteNumbers: string[];
} {
  return mergeCommercialDocReferences(
    ...subjects.map((subject) => parseCommercialDocReferences(subject)),
  );
}

export type CommercialThreadHints = {
  providerThreadId?: string | null;
  gmailThreadId?: string | null;
  threadId?: string | null;
  rfcMessageId?: string | null;
  /** Raw inbound body — scanned for References / In-Reply-To Message-IDs. */
  emailBody?: string | null;
};

/** Extract RFC Message-IDs from References / In-Reply-To lines in email text. */
export function extractRfcMessageIdsFromEmailText(text: string): string[] {
  const ids = new Set<string>();
  const blob = text.slice(0, 8000);
  for (const m of blob.matchAll(/(?:References|In-Reply-To):\s*([^\n\r]+)/gi)) {
    const header = m[1] ?? "";
    for (const id of header.matchAll(/<([^>]+)>/g)) {
      const v = id[1]?.trim().toLowerCase();
      if (v) ids.add(v);
    }
  }
  return [...ids];
}

function normalizeRfcId(value: string | null | undefined): string | null {
  const v = value?.trim().toLowerCase();
  if (!v) return null;
  return v.replace(/^<|>$/g, "");
}

/**
 * Resolve commercial doc numbers from email thread headers / prior outbound rows
 * on the same conversation (providerThreadId, gmailThreadId, threadId, rfcMessageId).
 */
export async function resolveCommercialRefsFromThread(input: {
  contactId: string;
} & CommercialThreadHints): Promise<{
  proposalNumbers: string[];
  quoteNumbers: string[];
}> {
  const or: Array<Record<string, string>> = [];
  const providerThreadId = input.providerThreadId?.trim();
  const gmailThreadId = input.gmailThreadId?.trim();
  const threadId = input.threadId?.trim();
  if (providerThreadId) or.push({ providerThreadId });
  if (gmailThreadId) or.push({ gmailThreadId });
  if (threadId) or.push({ threadId });

  const subjects: string[] = [];

  if (or.length > 0) {
    const rows = await prisma.contactActivity.findMany({
      where: {
        contactId: input.contactId,
        type: "email",
        OR: or,
      },
      orderBy: { createdAt: "asc" },
      select: {
        subject: true,
        emailDirection: true,
        folder: true,
      },
    });
    for (const row of rows) {
      const outbound =
        row.emailDirection === "outbound" || row.folder === "sent";
      if (outbound || row.subject) subjects.push(row.subject);
    }
  }

  const referencedRfcs = extractRfcMessageIdsFromEmailText(input.emailBody ?? "");
  if (referencedRfcs.length > 0) {
    const outbound = await prisma.contactActivity.findMany({
      where: {
        contactId: input.contactId,
        type: "email",
        OR: [{ emailDirection: "outbound" }, { folder: "sent" }],
        rfcMessageId: { not: null },
      },
      orderBy: { createdAt: "desc" },
      take: 40,
      select: { subject: true, rfcMessageId: true },
    });
    for (const row of outbound) {
      const rfc = normalizeRfcId(row.rfcMessageId);
      if (rfc && referencedRfcs.includes(rfc) && row.subject) {
        subjects.push(row.subject);
      }
    }
  }

  return parseCommercialRefsFromSubjects(subjects);
}

export function classifyCommercialDecision(text: string): CommercialDecision | null {
  const body = text.trim();
  if (!body) return null;
  if (COMMERCIAL_DECLINE.test(body)) return "decline";
  if (COMMERCIAL_ACCEPT.test(body)) return "accept";
  return null;
}

function normalizeNumber(value: string): string {
  return value.trim().toUpperCase();
}

export async function loadCommercialDocumentsForDeal(dealId: string) {
  const [proposals, quotes] = await Promise.all([
    prisma.proposal.findMany({
      where: { dealId },
      orderBy: { updatedAt: "desc" },
      select: {
        id: true,
        number: true,
        status: true,
        sharedAt: true,
        title: true,
      },
    }),
    prisma.quote.findMany({
      where: { dealId },
      orderBy: { updatedAt: "desc" },
      select: {
        id: true,
        number: true,
        status: true,
        sentAt: true,
      },
    }),
  ]);
  return { proposals, quotes };
}

export function resolveMatchedProposal(
  proposals: Awaited<
    ReturnType<typeof loadCommercialDocumentsForDeal>
  >["proposals"],
  proposalNumbers: string[],
): (typeof proposals)[number] | null {
  const sentLike = proposals.filter((p) => p.status === "shared");
  if (proposalNumbers.length > 0) {
    const wanted = new Set(proposalNumbers.map(normalizeNumber));
    const hit = sentLike.find((p) => wanted.has(normalizeNumber(p.number)));
    if (hit) return hit;
  }
  const sorted = [...sentLike].sort((a, b) => {
    const ta = a.sharedAt ? new Date(a.sharedAt).getTime() : 0;
    const tb = b.sharedAt ? new Date(b.sharedAt).getTime() : 0;
    return tb - ta;
  });
  return sorted[0] ?? null;
}

export function resolveMatchedQuote(
  quotes: Awaited<ReturnType<typeof loadCommercialDocumentsForDeal>>["quotes"],
  quoteNumbers: string[],
): (typeof quotes)[number] | null {
  const sent = quotes.filter((q) => q.status === "sent");
  if (quoteNumbers.length > 0) {
    const wanted = new Set(quoteNumbers.map(normalizeNumber));
    const hit = sent.find((q) => wanted.has(normalizeNumber(q.number)));
    if (hit) return hit;
  }
  const sorted = [...sent].sort((a, b) => {
    const ta = a.sentAt ? new Date(a.sentAt).getTime() : 0;
    const tb = b.sentAt ? new Date(b.sentAt).getTime() : 0;
    return tb - ta;
  });
  return sorted[0] ?? null;
}

export function dealHasBothCommercialDrafts(input: {
  proposals: Awaited<
    ReturnType<typeof loadCommercialDocumentsForDeal>
  >["proposals"];
  quotes: Awaited<
    ReturnType<typeof loadCommercialDocumentsForDeal>
  >["quotes"];
}): boolean {
  const hasProposal = input.proposals.some(
    (p) => !["declined"].includes(p.status),
  );
  const hasQuote = input.quotes.some(
    (q) => !["rejected", "void"].includes(q.status),
  );
  return hasProposal && hasQuote;
}

async function loadLatestInboundCustomerEmail(contactId: string): Promise<{
  subject: string;
  body: string;
  createdAt: string;
  providerThreadId: string | null;
  gmailThreadId: string | null;
  threadId: string | null;
  rfcMessageId: string | null;
} | null> {
  const rows = await prisma.contactActivity.findMany({
    where: {
      contactId,
      type: "email",
      emailDirection: "inbound",
    },
    orderBy: { createdAt: "desc" },
    take: 8,
    select: {
      subject: true,
      body: true,
      createdAt: true,
      type: true,
      emailDirection: true,
      providerThreadId: true,
      gmailThreadId: true,
      threadId: true,
      rfcMessageId: true,
    },
  });

  for (const row of rows) {
    const activity: SignalActivity = {
      type: row.type,
      subject: row.subject ?? "",
      body: row.body,
      emailDirection: row.emailDirection,
      createdAt: row.createdAt.toISOString(),
    };
    if (!isCustomerVoiceActivity(activity)) continue;
    return {
      subject: row.subject ?? "",
      body: row.body ?? "",
      createdAt: row.createdAt.toISOString(),
      providerThreadId: row.providerThreadId,
      gmailThreadId: row.gmailThreadId,
      threadId: row.threadId,
      rfcMessageId: row.rfcMessageId,
    };
  }
  return null;
}

function after(signalAt: string | undefined, reference: Date | string | null): boolean {
  if (!signalAt) return false;
  if (!reference) return true;
  return new Date(signalAt).getTime() >= new Date(reference).getTime();
}

export type CommercialMatchInput = {
  dealId: string;
  organizationId: string;
  emailSubject: string;
  emailBody: string;
  explicitDecision?: CommercialDecision | null;
  /** When the acceptance/decline signal fired (ISO). */
  signalAt?: string | null;
  /** Thread-derived PROP-/QUOTE- refs (merged with body/subject). */
  threadRefs?: { proposalNumbers: string[]; quoteNumbers: string[] } | null;
};

export async function matchCommercialDocument(input: CommercialMatchInput): Promise<{
  docType: CommercialDocType;
  decision: CommercialDecision;
  proposal: Awaited<
    ReturnType<typeof loadCommercialDocumentsForDeal>
  >["proposals"][number] | null;
  quote: Awaited<
    ReturnType<typeof loadCommercialDocumentsForDeal>
  >["quotes"][number] | null;
  bothOnDeal: boolean;
} | null> {
  const text = `${input.emailSubject}\n${input.emailBody}`.trim();
  const decision =
    input.explicitDecision ?? classifyCommercialDecision(text);
  if (!decision) return null;

  const bodyRefs = parseCommercialDocReferences(text);
  const refs = mergeCommercialDocReferences(
    bodyRefs,
    input.threadRefs ?? { proposalNumbers: [], quoteNumbers: [] },
  );
  const docs = await loadCommercialDocumentsForDeal(input.dealId);
  const bothOnDeal = dealHasBothCommercialDrafts(docs);

  const matchedQuote = resolveMatchedQuote(docs.quotes, refs.quoteNumbers);
  const matchedProposal = resolveMatchedProposal(
    docs.proposals,
    refs.proposalNumbers,
  );

  // Explicit QUOTE ref wins over PROP when both appear.
  if (matchedQuote && (refs.quoteNumbers.length > 0 || !matchedProposal)) {
    if (
      decision === "accept" &&
      !after(input.signalAt ?? undefined, matchedQuote.sentAt)
    ) {
      return null;
    }
    return {
      docType: "quote",
      decision,
      proposal: null,
      quote: matchedQuote,
      bothOnDeal,
    };
  }

  if (matchedProposal) {
    if (
      decision === "accept" &&
      !after(input.signalAt ?? undefined, matchedProposal.sharedAt)
    ) {
      return null;
    }
    return {
      docType: "proposal",
      decision,
      proposal: matchedProposal,
      quote: null,
      bothOnDeal,
    };
  }

  return null;
}

async function notifyInvoicePendingFromQuoteAccept(input: {
  organizationId: string;
  orderId: string;
  dealId: string;
  dealTitle: string | null;
  ownerUserId: string | null;
  contactId: string | null;
  actorUserId: string | null;
}): Promise<void> {
  const invoice = await prisma.invoice.findFirst({
    where: { orderId: input.orderId },
    orderBy: { createdAt: "desc" },
    select: { id: true, number: true },
  });
  if (!invoice) return;
  await notifyFinanceInvoicePendingApproval({
    organizationId: input.organizationId,
    invoiceId: invoice.id,
    invoiceNumber: invoice.number,
    dealTitle: input.dealTitle,
    dealId: input.dealId,
    ownerUserId: input.ownerUserId,
    contactId: input.contactId,
    actorUserId: input.actorUserId,
  });
}

/**
 * Apply commercial accept/decline from inbound email when lifecycle signals fire.
 * Returns an outcome when handled; null when nothing to do.
 */
export async function processCommercialAcceptance(
  ctx: LifecycleContext,
): Promise<ApplyOutcome | null> {
  if (ctx.businessType === "b2c" || !ctx.deal) return null;

  const s = ctx.signals;
  const commercialSignal =
    s.accepted ||
    s.declined ||
    COMMERCIAL_DECLINE.test(s.evidence.join(" "));
  if (!commercialSignal) return null;

  const docs = await loadCommercialDocumentsForDeal(ctx.deal.id);
  const hasSentDoc =
    docs.proposals.some((p) => p.status === "shared") ||
    docs.quotes.some((q) => q.status === "sent");
  if (!hasSentDoc) return null;

  const inbound = await loadLatestInboundCustomerEmail(ctx.contactId);
  if (!inbound) return null;

  const explicitDecision: CommercialDecision | null = s.accepted
    ? "accept"
    : s.declined || COMMERCIAL_DECLINE.test(`${inbound.subject}\n${inbound.body}`)
      ? "decline"
      : null;
  if (!explicitDecision && !classifyCommercialDecision(`${inbound.subject}\n${inbound.body}`)) {
    return null;
  }

  const threadRefs = await resolveCommercialRefsFromThread({
    contactId: ctx.contactId,
    providerThreadId: inbound.providerThreadId,
    gmailThreadId: inbound.gmailThreadId,
    threadId: inbound.threadId,
    rfcMessageId: inbound.rfcMessageId,
    emailBody: inbound.body,
  });

  const match = await matchCommercialDocument({
    dealId: ctx.deal.id,
    organizationId: ctx.organizationId,
    emailSubject: inbound.subject,
    emailBody: inbound.body,
    explicitDecision,
    signalAt: s.signalAt.accepted ?? s.signalAt.declined ?? inbound.createdAt,
    threadRefs,
  });
  if (!match) return null;

  const ownerUserId = ctx.deal.ownerUserId ?? ctx.ownerUserId;
  const dealTitle = ctx.deal.title;

  if (match.docType === "proposal" && match.proposal) {
    const proposal = match.proposal;
    if (match.decision === "decline") {
      if (proposal.status === "declined") {
        return {
          applied: false,
          ladder: "none",
          from: proposal.status,
          to: "declined",
          reason: "Proposal already declined.",
          dealId: ctx.deal.id,
          quoteId: null,
          blocked: "already_at_target",
        };
      }
      await updateProposal(proposal.id, { status: "declined" });
      await notifySalesCustomerDocumentDecision({
        organizationId: ctx.organizationId,
        ownerUserId,
        contactId: ctx.contactId,
        documentType: "proposal",
        documentId: proposal.id,
        documentNumber: proposal.number,
        dealId: ctx.deal.id,
        dealTitle,
        decision: "declined",
      });
      return {
        applied: true,
        ladder: "none",
        from: proposal.status,
        to: "declined",
        reason: `Customer declined proposal ${proposal.number}.`,
        dealId: ctx.deal.id,
        quoteId: null,
        blocked: null,
      };
    }

    if (proposal.status === "accepted") {
      return {
        applied: false,
        ladder: "none",
        from: "accepted",
        to: "accepted",
        reason: "Proposal already accepted.",
        dealId: ctx.deal.id,
        quoteId: null,
        blocked: "already_at_target",
      };
    }

    await updateProposal(proposal.id, { status: "accepted" });
    await notifySalesCustomerDocumentDecision({
      organizationId: ctx.organizationId,
      ownerUserId,
      contactId: ctx.contactId,
      documentType: "proposal",
      documentId: proposal.id,
      documentNumber: proposal.number,
      dealId: ctx.deal.id,
      dealTitle,
      decision: "accepted",
    });

    let quoteId: string | null = null;
    if (!match.bothOnDeal) {
      const created = await createQuoteDraftFromAcceptedProposal({
        proposalId: proposal.id,
        actorUserId: ctx.ownerUserId,
      }).catch((err) => {
        console.error("createQuoteDraftFromAcceptedProposal failed", err);
        return null;
      });
      quoteId = created?.quoteId ?? null;
    }

    return {
      applied: true,
      ladder: "none",
      from: proposal.status,
      to: "accepted",
      reason: match.bothOnDeal
        ? `Customer accepted proposal ${proposal.number}; quote already on deal — no further action.`
        : `Customer accepted proposal ${proposal.number}; quote draft created.`,
      dealId: ctx.deal.id,
      quoteId,
      blocked: null,
    };
  }

  if (match.docType === "quote" && match.quote) {
    const quote = match.quote;
    if (match.decision === "decline") {
      if (quote.status === "rejected") {
        return {
          applied: false,
          ladder: "none",
          from: quote.status,
          to: "rejected",
          reason: "Quote already rejected.",
          dealId: ctx.deal.id,
          quoteId: quote.id,
          blocked: "already_at_target",
        };
      }
      await rejectQuote(quote.id);
      await notifySalesCustomerDocumentDecision({
        organizationId: ctx.organizationId,
        ownerUserId,
        contactId: ctx.contactId,
        documentType: "quote",
        documentId: quote.id,
        documentNumber: quote.number,
        dealId: ctx.deal.id,
        dealTitle,
        decision: "declined",
      });
      return {
        applied: true,
        ladder: "none",
        from: quote.status,
        to: "rejected",
        reason: `Customer declined quote ${quote.number}.`,
        dealId: ctx.deal.id,
        quoteId: quote.id,
        blocked: null,
      };
    }

    const { quote: accepted, order } = await acceptQuote(
      quote.id,
      ctx.ownerUserId,
    );
    if (order) {
      await notifyInvoicePendingFromQuoteAccept({
        organizationId: ctx.organizationId,
        orderId: order.id,
        dealId: ctx.deal.id,
        dealTitle,
        ownerUserId,
        contactId: ctx.contactId,
        actorUserId: ctx.ownerUserId,
      });
    }
    await notifySalesCustomerDocumentDecision({
      organizationId: ctx.organizationId,
      ownerUserId,
      contactId: ctx.contactId,
      documentType: "quote",
      documentId: accepted.id,
      documentNumber: accepted.number,
      dealId: ctx.deal.id,
      dealTitle,
      decision: "accepted",
    });

    return {
      applied: true,
      ladder: "pipeline",
      from: quote.status,
      to: "accepted",
      reason: `Customer accepted quote ${quote.number}; invoice submitted for finance approval.`,
      dealId: ctx.deal.id,
      quoteId: accepted.id,
      blocked: null,
    };
  }

  return null;
}
