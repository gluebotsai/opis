import type { ProposalStatus, Prisma } from "@prisma/client";
import { prisma } from "@/dao/db/prisma";
import {
  getCurrentOrganizationId,
  resolveRequestOrganizationId,
} from "@/service/auth/require-role";
import { writeAuditLog } from "@/dao/audit/audit-log";
import {
  applyProposalMerge,
  parseProposalSections,
  type ProposalSection,
} from "@/lib/proposal-sections";
import { ensureDefaultProposalTemplate } from "@/dao/sales/proposal-template-service";
import { loadSellerOrganization } from "@/service/ai/seller-org";

export type CreateProposalInput = {
  dealId: string;
  title: string;
  summary?: string | null;
  attachmentUrl?: string | null;
  templateId?: string | null;
  sections?: ProposalSection[] | null;
  blueprint?: unknown;
  assets?: unknown;
  customerName?: string | null;
  createdByUserId?: string | null;
  organizationId?: string | null;
  approvalStatus?: string;
};

export type UpdateProposalInput = {
  title?: string;
  summary?: string | null;
  attachmentUrl?: string | null;
  status?: ProposalStatus;
  sections?: ProposalSection[] | null;
  customerName?: string | null;
  blueprint?: unknown;
  assets?: unknown;
  approvalStatus?: string;
};

async function nextProposalNumber(organizationId: string): Promise<string> {
  // Never use count()+1 — deletes leave gaps and collide with existing PROP-N.
  try {
    const all = await prisma.$queryRawUnsafe<Array<{ n: number | null }>>(
      `SELECT MAX(
         CASE
           WHEN number ~ '^PROP-[0-9]+$'
           THEN NULLIF(regexp_replace(number, '[^0-9]', '', 'g'), '')::int
           ELSE NULL
         END
       ) AS n
       FROM proposals
       WHERE organization_id = $1::bigint`,
      organizationId,
    );
    const max = all[0]?.n ?? 0;
    return `PROP-${String(max + 1).padStart(4, "0")}`;
  } catch {
    const rows = await prisma.proposal.findMany({
      where: { organizationId },
      select: { number: true },
    });
    let max = 0;
    for (const row of rows) {
      const m = /^PROP-(\d+)$/i.exec((row.number || "").trim());
      if (m) max = Math.max(max, Number.parseInt(m[1]!, 10) || 0);
    }
    return `PROP-${String(max + 1).padStart(4, "0")}`;
  }
}

function isUniqueConstraintError(err: unknown): boolean {
  if (!err || typeof err !== "object") return false;
  const e = err as { code?: string; message?: string };
  return (
    e.code === "P2002" ||
    /unique constraint failed/i.test(String(e.message || ""))
  );
}

async function resolveVendorName(organizationId: string): Promise<string> {
  const seller = await loadSellerOrganization(organizationId);
  const name = seller?.companyName?.trim();
  if (name) return name;
  return "Our company";
}

const inflightGenerateIds = new Set<string>();
const ABANDONED_GENERATE_SUMMARY =
  "Generation stopped because the server job is no longer running.";

export function markProposalGenerateInFlight(id: string) {
  const key = String(id || "").trim();
  if (key) inflightGenerateIds.add(key);
}

export function clearProposalGenerateInFlight(id: string) {
  inflightGenerateIds.delete(String(id || "").trim());
}

export async function failAbandonedGeneratingProposals(dealId?: string) {
  const keep = new Set([...inflightGenerateIds]);
  try {
    const { listActiveRunProposalIds } = await import(
      "@/dao/sales/proposal-generation-run"
    );
    for (const id of await listActiveRunProposalIds(dealId)) keep.add(id);
  } catch {
    // Prisma client may not include V2 models until migrate/generate.
  }
  const keepIds = [...keep];
  await prisma.proposal.updateMany({
    where: {
      approvalStatus: "generating",
      ...(dealId ? { dealId } : {}),
      ...(keepIds.length ? { id: { notIn: keepIds } } : {}),
    },
    data: {
      approvalStatus: "failed",
      summary: ABANDONED_GENERATE_SUMMARY,
    },
  });
}

export async function failAbandonedGeneratingProposal(id: string) {
  if (inflightGenerateIds.has(id)) return;
  try {
    const { getRunByProposalId } = await import(
      "@/dao/sales/proposal-generation-run"
    );
    const orgId = await getCurrentOrganizationId();
    const run = await getRunByProposalId(id, orgId);
    const active = [
      "queued",
      "preflight",
      "planning",
      "pricing",
      "writing",
      "qa",
    ];
    if (run && active.includes(run.status)) return;
  } catch {
    // ignore
  }
  await prisma.proposal.updateMany({
    where: { id, approvalStatus: "generating" },
    data: {
      approvalStatus: "failed",
      summary: ABANDONED_GENERATE_SUMMARY,
    },
  });
}

export async function listProposalsForDeal(dealId: string) {
  const deal = await prisma.deal.findUnique({
    where: { id: dealId },
    select: { id: true },
  });
  if (!deal) return [];
  await failAbandonedGeneratingProposals(dealId);
  // Filter by deal only — org-id resolution mismatches were hiding real rows
  // while the deal header still counted them from a different code path.
  return prisma.proposal.findMany({
    where: { dealId },
    include: { template: { select: { name: true } } },
    orderBy: { updatedAt: "desc" },
  });
}

export async function getProposal(id: string) {
  await failAbandonedGeneratingProposal(id);
  return prisma.proposal.findUnique({
    where: { id },
    include: {
      deal: {
        select: {
          id: true,
          title: true,
          contactName: true,
          contactEmail: true,
          contactId: true,
          ownerUserId: true,
          company: { select: { id: true, name: true } },
        },
      },
      template: { select: { id: true, name: true } },
    },
  });
}

export async function createProposal(input: CreateProposalInput) {
  const title = input.title.trim();
  if (!title) throw new Error("Proposal title is required.");

  const deal = await prisma.deal.findUnique({
    where: { id: input.dealId },
    include: { company: { select: { name: true } } },
  });
  if (!deal) throw new Error("Deal not found.");

  const organizationId = await resolveRequestOrganizationId(
    input.organizationId ?? deal.organizationId,
  );

  const baseData = {
    organizationId,
    dealId: input.dealId,
    templateId: input.templateId?.trim() || null,
    title,
    summary: input.summary?.trim() || null,
    sections: (input.sections ?? undefined) as Prisma.InputJsonValue | undefined,
    blueprint: (input.blueprint ?? undefined) as Prisma.InputJsonValue | undefined,
    assets: (input.assets ?? undefined) as Prisma.InputJsonValue | undefined,
    customerName: input.customerName?.trim() || null,
    attachmentUrl: input.attachmentUrl?.trim() || null,
    status: "draft" as const,
    version: 1,
    createdByUserId: input.createdByUserId ?? null,
    ...(input.approvalStatus
      ? { approvalStatus: input.approvalStatus }
      : {}),
  };

  let proposal: Awaited<ReturnType<typeof prisma.proposal.create>> | null = null;
  let number = "";
  for (let attempt = 0; attempt < 8; attempt++) {
    number = await nextProposalNumber(organizationId);
    try {
      proposal = await prisma.proposal.create({
        data: { ...baseData, number },
      });
      break;
    } catch (err) {
      if (!isUniqueConstraintError(err) || attempt === 7) throw err;
      // Concurrent create grabbed this number — bump and retry.
    }
  }
  if (!proposal) throw new Error("Could not allocate a proposal number.");

  await writeAuditLog({
    action: "create",
    entityType: "proposal",
    entityId: proposal.id,
    meta: { dealId: input.dealId, number },
  });

  return proposal;
}

/** Create a customer-specific proposal by cloning the org standard (or chosen) template. */
export type ProposalFromTemplateDraft = {
  dealId: string;
  organizationId: string;
  templateId: string;
  title: string;
  customerName: string;
  vendorName: string;
  sections: ProposalSection[];
  blueprint: unknown;
  assets: unknown;
  context: {
    customerName: string;
    companyName: string;
    companyDomain: string | null;
    companyIndustry: string | null;
    companyEmployeeCount: number | null;
    dealTitle: string;
    dealStage: string;
    dealAmount: string | null;
    dealNotes: string | null;
    contactName: string | null;
    contactEmail: string | null;
    date: string;
    vendorName: string;
    /** Seller (tenant) profile from accounts.organizations — read-only. */
    seller?: {
      companyName: string | null;
      industryType: string | null;
      businessType: string | null;
      websiteUrl: string | null;
      country: string | null;
      companySize: string | null;
      contactName: string | null;
      workEmail: string | null;
      billingAddress?: string | null;
    } | null;
  };
};

/** Resolve template + token-merge sections (no AI, no persist). */
export async function prepareProposalFromTemplate(input: {
  dealId: string;
  templateId?: string | null;
  title?: string | null;
}): Promise<ProposalFromTemplateDraft> {
  const deal = await prisma.deal.findUnique({
    where: { id: input.dealId },
    include: {
      company: {
        select: {
          name: true,
          domain: true,
          industry: true,
          employeeCount: true,
        },
      },
    },
  });
  if (!deal) throw new Error("Deal not found.");

  const organizationId = await getCurrentOrganizationId();
  if (deal.organizationId !== organizationId) {
    throw new Error("Deal not found.");
  }

  let template = input.templateId
    ? await prisma.proposalTemplate.findFirst({
        where: { id: input.templateId, organizationId },
      })
    : null;
  if (!template) {
    const ensured = await ensureDefaultProposalTemplate(organizationId);
    template = await prisma.proposalTemplate.findFirstOrThrow({
      where: { id: ensured.id },
    });
  }

  const companyName = deal.company?.name?.trim() || "Customer";
  // B2B cover / "Submitted to" must be the company (POTHYS-style), not the contact.
  const contactName = deal.contactName?.trim() || null;
  const customerName = companyName;
  const seller = await loadSellerOrganization(organizationId);
  const vendorName =
    seller?.companyName?.trim() || (await resolveVendorName(organizationId));
  const date = new Date().toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });

  const sections = applyProposalMerge(parseProposalSections(template.sections), {
    customerName,
    companyName,
    dealTitle: deal.title,
    date,
    vendorName,
  });

  const title =
    input.title?.trim() ||
    `Proposal for ${companyName} — ${deal.title}`;

  const amount =
    deal.amount != null ? String(deal.amount) : null;

  return {
    dealId: input.dealId,
    organizationId,
    templateId: template.id,
    title,
    customerName: companyName,
    vendorName,
    sections,
    blueprint: template.blueprint ?? null,
    assets: template.assets ?? null,
    context: {
      customerName,
      companyName,
      companyDomain: deal.company?.domain ?? null,
      companyIndustry: deal.company?.industry ?? null,
      companyEmployeeCount: deal.company?.employeeCount ?? null,
      dealTitle: deal.title,
      dealStage: deal.stage,
      dealAmount: amount,
      dealNotes: deal.notes?.trim() || null,
      contactName,
      contactEmail: deal.contactEmail?.trim() || null,
      date,
      vendorName,
      seller: seller
        ? {
            companyName: seller.companyName,
            industryType: seller.industryType,
            businessType: seller.businessType,
            websiteUrl: seller.websiteUrl,
            country: seller.country,
            companySize: seller.companySize,
            contactName: seller.contactName,
            workEmail: seller.workEmail,
            billingAddress: seller.billingAddress,
          }
        : null,
    },
  };
}

/** When a proposal row has no sections JSON (legacy post-meeting stub), hydrate from template. */
export async function resolveProposalSectionsWithTemplateFallback(input: {
  dealId: string;
  templateId?: string | null;
  title?: string | null;
  sectionsRaw: unknown;
}): Promise<{
  sections: ProposalSection[];
  draft: ProposalFromTemplateDraft;
  bootstrapped: boolean;
}> {
  const draft = await prepareProposalFromTemplate({
    dealId: input.dealId,
    templateId: input.templateId,
    title: input.title,
  });
  let sections = parseProposalSections(input.sectionsRaw);
  const bootstrapped = sections.length === 0;
  if (bootstrapped) {
    sections = draft.sections;
  }
  return { sections, draft, bootstrapped };
}

export async function createProposalFromTemplate(input: {
  dealId: string;
  templateId?: string | null;
  title?: string | null;
  createdByUserId?: string | null;
  /** When set, skip token-merge and use these sections (already personalized). */
  sectionsOverride?: ProposalSection[] | null;
}) {
  const draft = await prepareProposalFromTemplate({
    dealId: input.dealId,
    templateId: input.templateId,
    title: input.title,
  });

  const sections = input.sectionsOverride?.length
    ? input.sectionsOverride
    : draft.sections;

  return createProposal({
    dealId: draft.dealId,
    title: draft.title,
    summary: `Customer-specific proposal for ${draft.customerName}.`,
    templateId: draft.templateId,
    sections,
    blueprint: draft.blueprint ?? undefined,
    assets: draft.assets ?? undefined,
    customerName: draft.customerName,
    createdByUserId: input.createdByUserId,
    organizationId: draft.organizationId,
  });
}

function isCustomerFacingDocumentUrl(url: string | null | undefined): boolean {
  const raw = url?.trim();
  if (!raw) return false;
  try {
    const parsed = new URL(raw);
    return parsed.protocol === "http:" || parsed.protocol === "https:";
  } catch {
    return false;
  }
}

function hasProposalDeliverable(
  attachment: { filename: string; buffer: Buffer } | null | undefined,
  attachmentUrl: string | null | undefined,
): boolean {
  if (attachment?.buffer?.length) return true;
  return isCustomerFacingDocumentUrl(attachmentUrl);
}

/** Email the proposal PDF (or external link) to the deal contact — never CRM-only copy. */
export async function emailProposalToContact(args: {
  proposalNumber: string;
  proposalTitle: string;
  dealTitle: string | null;
  contactName: string | null;
  contactEmail: string;
  contactId: string | null;
  organizationId: string | bigint;
  actorUserId: string;
  attachment?: { filename: string; buffer: Buffer } | null;
  attachmentUrl?: string | null;
}): Promise<{ ok: true } | { ok: false; error: string; needsConnect?: boolean }> {
  const attachment = args.attachment?.buffer?.length ? args.attachment : null;
  const externalUrl = isCustomerFacingDocumentUrl(args.attachmentUrl)
    ? args.attachmentUrl!.trim()
    : null;

  if (!attachment && !externalUrl) {
    return {
      ok: false,
      error:
        "Cannot email the customer without a proposal PDF or a public document link.",
    };
  }

  const seller = await loadSellerOrganization(String(args.organizationId));
  const vendorName = seller?.companyName?.trim() || "Our team";
  const attachmentLine = attachment
    ? "Please find the proposal attached as a PDF."
    : `You can view the full proposal here: ${externalUrl}`;

  const body = [
    `Hello${args.contactName ? ` ${args.contactName}` : ""},`,
    "",
    `Please find proposal ${args.proposalNumber} (${args.proposalTitle}) for ${args.dealTitle ?? "your opportunity"}.`,
    "",
    attachmentLine,
    "",
    "Reply to this email if you have questions.",
    "",
    `— ${vendorName}`,
  ].join("\n");

  const { sendTransactionalEmail } = await import(
    "@/service/mail/send-transactional"
  );
  const sent = await sendTransactionalEmail({
    userId: args.actorUserId,
    to: args.contactEmail,
    subject: `Proposal ${args.proposalNumber} — ${args.dealTitle ?? args.proposalTitle}`,
    body,
    contactId: args.contactId,
    attachments: attachment
      ? [
          {
            filename: attachment.filename,
            contentType: "application/pdf",
            content: attachment.buffer,
          },
        ]
      : undefined,
  });

  if (!sent.ok) {
    return {
      ok: false,
      error: sent.error,
      needsConnect: sent.needsConnect,
    };
  }
  return { ok: true };
}

export async function markProposalSent(
  id: string,
  actorUserId?: string | null,
  attachment?: { filename: string; buffer: Buffer } | null,
) {
  const existing = await prisma.proposal.findUnique({
    where: { id },
    include: {
      deal: {
        select: {
          id: true,
          title: true,
          contactId: true,
          contactEmail: true,
          contactName: true,
          ownerUserId: true,
        },
      },
    },
  });
  if (!existing) throw new Error("Proposal not found.");
  if (existing.status !== "draft") {
    throw new Error("Only draft proposals can be sent.");
  }

  const { assertDocumentApprovedForSend } = await import(
    "@/service/sales/document-approval"
  );
  assertDocumentApprovedForSend(
    {
      approvedByUserId: existing.approvedByUserId,
      approvedAt: existing.approvedAt,
    },
    "proposal",
  );

  if (
    !hasProposalDeliverable(attachment, existing.attachmentUrl) &&
    existing.deal?.contactEmail?.trim()
  ) {
    throw new Error(
      "Cannot send proposal without a PDF for the customer. Generate the PDF (install Playwright: npx playwright install chromium) or add a public document link before sending.",
    );
  }

  const proposal = await prisma.proposal.update({
    where: { id },
    data: {
      status: "shared",
      sharedAt: new Date(),
      approvalStatus: "shared",
    },
  });

  await writeAuditLog({
    actorUserId,
    action: "proposal_sent",
    entityType: "proposal",
    entityId: id,
    organizationId: proposal.organizationId,
  });

  let emailWarning: string | null = null;
  const to = existing.deal?.contactEmail?.trim();
  if (!actorUserId) {
    emailWarning = "Marked shared; sign in again to email the customer.";
  } else if (!to) {
    emailWarning =
      "Marked shared; no contact email on the deal to deliver the proposal.";
  } else if (hasProposalDeliverable(attachment, existing.attachmentUrl)) {
    const emailed = await emailProposalToContact({
      proposalNumber: existing.number,
      proposalTitle: existing.title,
      dealTitle: existing.deal?.title ?? null,
      contactName: existing.deal?.contactName ?? null,
      contactEmail: to,
      contactId: existing.deal?.contactId ?? null,
      organizationId: proposal.organizationId,
      actorUserId,
      attachment,
      attachmentUrl: existing.attachmentUrl,
    });
    if (!emailed.ok) {
      emailWarning = emailed.needsConnect
        ? "Marked shared; connect email in Configuration to deliver to the customer."
        : `Marked shared; email failed: ${emailed.error}`;
    }
  }

  if (existing.deal?.contactId) {
    const { triggerLeadLifecycle } = await import(
      "@/service/ai/lead-lifecycle-trigger"
    );
    triggerLeadLifecycle({
      contactId: existing.deal.contactId,
      organizationId: proposal.organizationId,
      triggerReason: "proposal_sent",
    });
  }

  return { proposal, emailWarning };
}

export async function updateProposal(id: string, input: UpdateProposalInput) {
  const existing = await prisma.proposal.findUnique({ where: { id } });
  if (!existing) throw new Error("Proposal not found.");

  const data: Prisma.ProposalUpdateInput = {};

  if (input.title !== undefined) {
    const title = input.title.trim();
    if (!title) throw new Error("Proposal title is required.");
    data.title = title;
  }
  if (input.summary !== undefined) {
    data.summary = input.summary?.trim() || null;
  }
  if (input.attachmentUrl !== undefined) {
    data.attachmentUrl = input.attachmentUrl?.trim() || null;
  }
  if (input.customerName !== undefined) {
    data.customerName = input.customerName?.trim() || null;
  }
  if (input.sections !== undefined) {
    data.sections = input.sections as Prisma.InputJsonValue;
  }
  if (input.blueprint !== undefined) {
    data.blueprint = (input.blueprint ?? undefined) as Prisma.InputJsonValue;
  }
  if (input.assets !== undefined) {
    data.assets = (input.assets ?? undefined) as Prisma.InputJsonValue;
  }
  if (input.status !== undefined) {
    data.status = input.status;
    if (input.status === "shared" && !existing.sharedAt) {
      data.sharedAt = new Date();
    }
  }
  if (input.approvalStatus !== undefined) {
    data.approvalStatus = input.approvalStatus;
  }

  const proposal = await prisma.proposal.update({
    where: { id },
    data,
  });

  await writeAuditLog({
    action: "update",
    entityType: "proposal",
    entityId: proposal.id,
    meta: { status: proposal.status },
  });

  return proposal;
}

export async function createProposalVersion(id: string) {
  const existing = await prisma.proposal.findUnique({ where: { id } });
  if (!existing) throw new Error("Proposal not found.");

  const proposal = await prisma.proposal.create({
    data: {
      organizationId: existing.organizationId,
      dealId: existing.dealId,
      templateId: existing.templateId,
      number: existing.number,
      title: existing.title,
      summary: existing.summary,
      sections: existing.sections ?? undefined,
      blueprint: existing.blueprint ?? undefined,
      assets: existing.assets ?? undefined,
      customerName: existing.customerName,
      attachmentUrl: existing.attachmentUrl,
      status: "draft",
      version: existing.version + 1,
      createdByUserId: existing.createdByUserId,
    },
  });

  await writeAuditLog({
    action: "create",
    entityType: "proposal",
    entityId: proposal.id,
    meta: {
      dealId: proposal.dealId,
      number: proposal.number,
      version: proposal.version,
      fromId: id,
    },
  });

  return proposal;
}

export async function deleteProposal(id: string) {
  const existing = await prisma.proposal.findUnique({ where: { id } });
  if (!existing) throw new Error("Proposal not found.");
  if (existing.status === "accepted") {
    throw new Error("Accepted proposals cannot be deleted.");
  }

  await prisma.proposal.delete({ where: { id } });
  await writeAuditLog({
    action: "delete",
    entityType: "proposal",
    entityId: id,
    meta: { dealId: existing.dealId },
  });
}
