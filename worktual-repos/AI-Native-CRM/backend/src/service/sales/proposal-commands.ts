/**
 * Proposal + template commands (tenant-scoped standard + customer-specific).
 */

import type { ProposalStatus } from "@prisma/client";
import { prisma } from "@/dao/db/prisma";
import { getServerUserId } from "@/service/account/session-cookie";
import { canEditDeals, canManageDocumentTemplates } from "@/service/auth/rbac";
import { requireRole } from "@/service/auth/require-role";
import { assertRecordAccess } from "@/service/auth/ownership-scope";
import { getDeal } from "@/dao/sales/deal-service";
import {
  createProposalVersion,
  deleteProposal,
  getProposal,
  listProposalsForDeal,
  resolveProposalSectionsWithTemplateFallback,
  updateProposal,
  markProposalSent,
} from "@/dao/sales/proposal-service";
import {
  createProposalFromPlaybookCommand,
  readStoredProposalRequirement,
} from "@/service/sales/proposal-from-playbook-commands";
import { loadMeetingNotesForDeal } from "@/service/ai/proposal-brief";
import {
  createProposalTemplate,
  ensureDefaultProposalTemplate,
  getProposalTemplate,
  listProposalTemplates,
  updateProposalTemplate,
  deleteProposalTemplate,
} from "@/dao/sales/proposal-template-service";
import {
  normalizeProposalSections,
  parseProposalSections,
  rewriteContactAsCompanyRecipient,
  rewriteSellerContactAsVendor,
  formatCompanyDisplayName,
  type ProposalSection,
} from "@/lib/proposal-sections";
import {
  parseBlueprintAssets,
  parseBlueprintAssetsStrict,
  parseDocumentBlueprint,
  renderBlueprintHtml,
  stripInBodyPageChrome,
} from "@/lib/document-blueprint";
import { htmlToPdfBuffer, chromeFromBlueprintAssets } from "@/service/sales/proposal-pdf";
import { proposalHtmlToDocxBuffer } from "@/service/sales/proposal-docx";
import { rewriteProposalSectionBodies } from "@/service/sales/proposal-section-rewrite";
import {
  buildClonePersonalizeContext,
  isPageCloneBlueprint,
  personalizePageCloneDocument,
} from "@/service/sales/document-clone-personalize";
import { loadSellerOrganization } from "@/service/ai/seller-org";
import {
  adaptProposalVisuals,
  proposalProductScope,
  resolveDealProposalCatalog,
  resolveProposalProductScope,
  productScopeForCoverParens,
} from "@/service/sales/proposal-visuals";
import { buildPlaybookDocumentBlueprint } from "@/lib/proposal-playbook-layout";
import {
  isProposalDocHtml,
  mergeProposalDocHtml,
  sectionsFromProposalDocHtml,
  applySectionToProposalDocHtml,
  mergeVisibleSectionBodies,
} from "@/lib/proposal-doc-html";
import { repairMarkdownEmphasisInHtml } from "@/lib/template-edit-patch";

async function syncPageCloneAfterSectionUpdate(input: {
  proposal: NonNullable<Awaited<ReturnType<typeof getProposal>>>;
  sections: ProposalSection[];
}): Promise<{
  blueprint?: unknown;
  assets?: unknown;
  warnings: string[];
}> {
  const blueprint = parseDocumentBlueprint(input.proposal.blueprint);
  if (!blueprint || !isPageCloneBlueprint(blueprint)) {
    return { warnings: [] };
  }

  const seller = await loadSellerOrganization(input.proposal.organizationId);
  const vendorName = seller?.companyName?.trim() || "Our company";
  const date = new Date(input.proposal.updatedAt).toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
  const scoped = await resolveProposalProductScope({
    dealId: input.proposal.dealId,
    organizationId: input.proposal.organizationId,
    dealTitle: input.proposal.deal.title,
    dealNotes: null,
    title: input.proposal.title,
    summary: input.proposal.summary,
    matchText: input.sections.map((s) => `${s.title}\n${s.body}`).join("\n"),
  }).catch(() => null);
  const customerName = formatCompanyDisplayName(
    input.proposal.deal.company?.name?.trim() ||
      input.proposal.customerName?.trim() ||
      "Customer",
  );
  const productScope =
    scoped?.product?.name ||
    scoped?.productScope ||
    proposalProductScope(null, input.proposal.deal.title || "");

  const personalizeCtx = await buildClonePersonalizeContext({
    kind: "proposal",
    organizationId: String(input.proposal.organizationId),
    dealId: input.proposal.dealId,
    companyName: customerName,
    customerName,
    dealTitle: input.proposal.deal.title,
    vendorName,
    date,
    productScope,
    productHint: scoped?.productHint ?? null,
  });

  const personalized = await personalizePageCloneDocument({
    blueprint: input.proposal.blueprint,
    assets: input.proposal.assets,
    sections: input.sections.map((s) => ({
      id: s.id,
      key: s.key,
      title: s.title,
      body: s.body,
      sortOrder: s.sortOrder,
    })),
    context: personalizeCtx,
    contentFill: true,
  });

  if (!personalized.applied || !personalized.blueprint) {
    return { warnings: personalized.warnings };
  }

  return {
    blueprint: personalized.blueprint,
    assets: personalized.assets,
    warnings: personalized.warnings,
  };
}

function syncPlaybookHtmlAfterSectionUpdate(input: {
  proposal: NonNullable<Awaited<ReturnType<typeof getProposal>>>;
  changed: ProposalSection;
}): { blueprint?: unknown; warnings: string[] } {
  const blueprint = parseDocumentBlueprint(input.proposal.blueprint);
  if (!blueprint || !isProposalDocHtml(blueprint.html)) {
    return { warnings: [] };
  }
  const html = applySectionToProposalDocHtml(blueprint.html, input.changed);
  if (html === blueprint.html) {
    return { warnings: [] };
  }
  return {
    blueprint: { ...blueprint, html },
    warnings: [],
  };
}
import { notifyAdminsAsync } from "@/dao/notifications/notify-admins";

export type ProposalCommandResult =
  | { ok: true; id: string; warning?: string }
  | { ok: false; error: string };

export type ProposalRow = {
  id: string;
  number: string;
  title: string;
  summary: string | null;
  customerName: string | null;
  version: number;
  status: ProposalStatus;
  attachmentUrl: string | null;
  hasSections: boolean;
  templateName: string | null;
  updatedAt: string;
  approvalStatus?: string | null;
  generationRun?: {
    id: string;
    status: string;
    progress?: { done: number; total: number; label: string };
    pricingIssues?: unknown;
  } | null;
};

function mapProposalListItem(p: {
  id: string;
  number: string;
  title: string;
  summary: string | null;
  customerName: string | null;
  version: number;
  status: ProposalStatus;
  attachmentUrl: string | null;
  sections: unknown;
  updatedAt: Date;
  template?: { name: string } | null;
  approvalStatus?: string | null;
}): ProposalRow {
  return {
    id: p.id,
    number: p.number,
    title: p.title,
    summary: p.summary,
    customerName: p.customerName,
    version: p.version,
    status: p.status,
    attachmentUrl: p.attachmentUrl,
    hasSections: parseProposalSections(p.sections).length > 0,
    templateName: p.template?.name ?? null,
    updatedAt: p.updatedAt.toISOString(),
    approvalStatus: p.approvalStatus ?? null,
  };
}

async function assertDealAccess(dealId: string) {
  const deal = await getDeal(dealId);
  if (!deal) throw new Error("Deal not found.");
  await assertRecordAccess(deal.ownerUserId);
  return deal;
}

export async function listProposalsForDealCommand(
  dealId: string,
): Promise<{ ok: true; items: ProposalRow[] } | { ok: false; error: string }> {
  try {
    await assertDealAccess(dealId);
    const proposals = await listProposalsForDeal(dealId);
    const items = await Promise.all(
      proposals.map(async (p) => {
        const row = mapProposalListItem(p);
        try {
          const { getProposalGenerationRunForProposalCommand } = await import(
            "@/service/sales/proposal-run-commands"
          );
          const run = await getProposalGenerationRunForProposalCommand(p.id);
          if (run.ok) row.generationRun = run.run;
        } catch {
          // ignore
        }
        return row;
      }),
    );
    return { ok: true, items };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : "Failed to load proposals.",
    };
  }
}

export async function getProposalCommand(id: string) {
  try {
    const proposal = await getProposal(id);
    if (!proposal) {
      return { ok: false as const, error: "Proposal not found.", status: 404 };
    }
    await assertRecordAccess(proposal.deal.ownerUserId);
    const seller = await loadSellerOrganization(proposal.organizationId);
    const companyName = proposal.deal.company?.name?.trim() || null;
    const sections = rewriteSellerContactAsVendor(
      rewriteContactAsCompanyRecipient(
        normalizeProposalSections(parseProposalSections(proposal.sections)),
        {
          contactName: proposal.deal.contactName,
          companyName,
        },
      ),
      {
        sellerContactName: seller?.contactName,
        vendorName: seller?.companyName?.trim() || "Our company",
      },
    );
    const scoped = await resolveProposalProductScope({
      dealId: proposal.dealId,
      organizationId: proposal.organizationId,
      dealTitle: proposal.deal.title,
      dealNotes: null,
      title: proposal.title,
      summary: proposal.summary,
      matchText: sections.map((s) => `${s.title}\n${s.body}`).join("\n"),
    }).catch(() => null);

    // Prefer stored playbook/page layout. Older drafts (no blueprint) get a
    // playbook-style shell so preview/PDF never fall back to Georgia + rainbow chrome.
    const storedBlueprint = parseDocumentBlueprint(proposal.blueprint);
    if (storedBlueprint?.html) {
      const repaired = repairMarkdownEmphasisInHtml(storedBlueprint.html);
      if (repaired !== storedBlueprint.html) {
        storedBlueprint.html = repaired;
      }
    }
    const storedAssets = parseBlueprintAssets(proposal.assets);
    const isPageClone =
      storedBlueprint?.mode === "page-clone" ||
      /bp-page-clone/i.test(storedBlueprint?.html || "");
    const blueprint =
      storedBlueprint && !isPageClone
        ? storedBlueprint
        : !storedBlueprint
          ? buildPlaybookDocumentBlueprint({
              sections: sections.map((s) => ({
                key: s.key,
                title: s.title,
              })),
            })
          : null;

    const result = {
      ok: true as const,
      proposal: {
        id: proposal.id,
        number: proposal.number,
        title: proposal.title,
        summary: proposal.summary,
        // Always expose company as the customer recipient for B2B covers.
        customerName: companyName || proposal.customerName,
        version: proposal.version,
        status: proposal.status,
        attachmentUrl: proposal.attachmentUrl,
        sections,
        blueprint: isPageClone ? storedBlueprint : blueprint,
        assets: isPageClone ? storedAssets : [],
        dealId: proposal.dealId,
        dealTitle: proposal.deal.title,
        companyName,
        contactName: proposal.deal.contactName,
        templateId: null,
        templateName: null,
        vendorName: seller?.companyName?.trim() || "Our company",
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
        productScope:
          scoped?.productScope ||
          proposalProductScope(null, proposal.deal.title || ""),
        sharedAt: proposal.sharedAt?.toISOString() ?? null,
        createdAt: proposal.createdAt.toISOString(),
        updatedAt: proposal.updatedAt.toISOString(),
        approvalStatus: proposal.approvalStatus ?? null,
        generationRun: null as {
          id: string;
          status: string;
          progress?: { done: number; total: number; label: string };
          pricingIssues?: unknown;
        } | null,
      },
    };
    try {
      const { getProposalGenerationRunForProposalCommand } = await import(
        "@/service/sales/proposal-run-commands"
      );
      const run = await getProposalGenerationRunForProposalCommand(proposal.id);
      if (run.ok) {
        result.proposal.generationRun = run.run;
      }
    } catch {
      // ignore
    }
    return result;
  } catch (err) {
    return {
      ok: false as const,
      error: err instanceof Error ? err.message : "Failed to load proposal.",
      status: 404,
    };
  }
}

async function prepareProposalDocumentExport(id: string) {
  const proposal = await getProposal(id);
  if (!proposal) {
    return { ok: false as const, error: "Proposal not found.", status: 404 };
  }
  await assertRecordAccess(proposal.deal.ownerUserId);

  const date = new Date(proposal.updatedAt).toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
  const seller = await loadSellerOrganization(proposal.organizationId);
  const vendorName = seller?.companyName?.trim() || "Our company";
  const sections = rewriteSellerContactAsVendor(
    rewriteContactAsCompanyRecipient(
      normalizeProposalSections(parseProposalSections(proposal.sections)),
      {
        contactName: proposal.deal.contactName,
        companyName: proposal.deal.company?.name,
      },
    ),
    {
      sellerContactName: seller?.contactName,
      vendorName,
    },
  );
  const scoped = await resolveProposalProductScope({
    dealId: proposal.dealId,
    organizationId: proposal.organizationId,
    dealTitle: proposal.deal.title,
    dealNotes: null,
    title: proposal.title,
    summary: proposal.summary,
    matchText: sections.map((s) => `${s.title}\n${s.body}`).join("\n"),
  }).catch(() => null);

  const storedBlueprint = parseDocumentBlueprint(proposal.blueprint);
  const storedAssets = parseBlueprintAssets(proposal.assets);
  const isPageClone =
    storedBlueprint?.mode === "page-clone" ||
    /bp-page-clone/i.test(storedBlueprint?.html || "");
  const company = formatCompanyDisplayName(
    proposal.deal.company?.name?.trim() ||
      proposal.customerName?.trim() ||
      "Customer",
  );
  const productScope =
    scoped?.product?.name ||
    scoped?.productScope ||
    proposalProductScope(null, proposal.deal.title || "");
  const sellerAddress = seller?.billingAddress?.trim() || "";

  let html: string;
  let stampAssets = storedAssets;
  let useLegacyChrome = false;
  const tokens = {
    customerName: company,
    companyName: company,
    dealTitle: proposal.deal.title || "",
    date,
    vendorName,
    productScope: productScopeForCoverParens(productScope),
    sellerAddress,
  };

  if (isPageClone && storedBlueprint) {
    const visuals = await adaptProposalVisuals({
      blueprint: storedBlueprint,
      assets: storedAssets,
      product: scoped?.product ?? null,
      dealTitle: proposal.deal.title || "",
      sellerAddress,
      productHint: scoped?.productHint ?? null,
      kind: "proposal",
    });
    const blueprint = visuals.blueprint ?? storedBlueprint;
    stampAssets = visuals.assets.length > 0 ? visuals.assets : storedAssets;
    html = renderBlueprintHtml({
      blueprint,
      assets: stampAssets,
      sections,
      tokens,
    });
    useLegacyChrome = storedBlueprint.chrome === true;
  } else {
    const blueprint =
      storedBlueprint && storedBlueprint.mode !== "page-clone"
        ? storedBlueprint
        : buildPlaybookDocumentBlueprint({
            sections: sections.map((s) => ({
              key: s.key,
              title: s.title,
            })),
          });
    html = renderBlueprintHtml({
      blueprint,
      assets: stampAssets,
      sections,
      tokens,
    });
    if (!storedBlueprint) {
      void updateProposal(proposal.id, { blueprint }).catch(() => undefined);
    }
  }

  return {
    ok: true as const,
    proposal,
    html,
    sections,
    vendorName,
    customerName: company,
    date,
    stampAssets,
    useLegacyChrome,
    sellerAddress,
  };
}

export async function getProposalPdfCommand(id: string) {
  try {
    const prep = await prepareProposalDocumentExport(id);
    if (!prep.ok) return prep;
    const frozen = /proposal-doc|cover-block/i.test(prep.html);
    const buffer = await htmlToPdfBuffer(
      frozen ? prep.html : stripInBodyPageChrome(prep.html),
      prep.useLegacyChrome
        ? chromeFromBlueprintAssets(
            prep.stampAssets,
            prep.vendorName,
            prep.sellerAddress,
          )
        : null,
      { useBlueprintMargins: !prep.useLegacyChrome },
    );
    return {
      ok: true as const,
      buffer,
      filename: `${prep.proposal.number || "proposal"}.pdf`,
    };
  } catch (err) {
    console.error(
      "[proposal-pdf]",
      err instanceof Error ? err.stack || err.message : err,
    );
    return {
      ok: false as const,
      error:
        err instanceof Error
          ? err.message
          : "Failed to generate PDF. Ensure Playwright Chromium is installed.",
      status: 500,
    };
  }
}

export async function getProposalDocxCommand(id: string) {
  try {
    const prep = await prepareProposalDocumentExport(id);
    if (!prep.ok) return prep;
    const buffer = await proposalHtmlToDocxBuffer({
      number: prep.proposal.number,
      title: prep.proposal.title,
      customerName: prep.customerName,
      vendorName: prep.vendorName,
      date: prep.date,
      html: prep.html,
      sections: prep.sections.map((s) => ({ title: s.title, body: s.body })),
    });
    return {
      ok: true as const,
      buffer,
      filename: `${prep.proposal.number || "proposal"}.docx`,
    };
  } catch (err) {
    return {
      ok: false as const,
      error:
        err instanceof Error ? err.message : "Failed to generate Word document.",
      status: 500,
    };
  }
}

export async function createProposalCommand(input: {
  dealId: string;
  title: string;
  summary?: string | null;
  attachmentUrl?: string | null;
  /** @deprecated Ignored — all creates use learned playbooks. */
  fromTemplate?: boolean;
  templateId?: string | null;
  /** Product/topic hint from coworker chat. */
  productHint?: string | null;
  productIds?: string[] | null;
  /** Optional customer BRD / requirement file (base64). */
  requirementPdfBase64?: string | null;
  requirementFilename?: string | null;
}): Promise<
  | { ok: true; id: string; warnings?: string[] }
  | { ok: false; error: string }
> {
  try {
    await requireRole(canEditDeals, "You cannot create proposals.");
    const deal = await assertDealAccess(input.dealId);
    const userId = await getServerUserId();

    const productHint =
      input.productHint?.trim() ||
      (input.title?.includes("—")
        ? input.title.split("—").slice(1).join("—").trim()
        : null) ||
      null;

    const pdfB64 = input.requirementPdfBase64?.trim() || "";
    const meetingNotes = await loadMeetingNotesForDeal(input.dealId);
    if (!pdfB64 && !meetingNotes?.trim()) {
      return {
        ok: false as const,
        error:
          "Attach a BRD (PDF, Word, or text) or generate from a meeting on this deal.",
      };
    }

    const requirement = [
      productHint,
      input.title?.trim(),
      input.summary?.trim(),
      deal.notes?.trim(),
      deal.title ? `Customer need related to: ${deal.title}` : "",
      deal.company?.name ? `Company: ${deal.company.name}` : "",
      deal.contactName ? `Contact: ${deal.contactName}` : "",
    ]
      .filter(Boolean)
      .join("\n\n");

    const result = await createProposalFromPlaybookCommand({
      dealId: input.dealId,
      requirementText:
        requirement.length >= 8
          ? requirement
          : `Write a sales proposal for ${deal.company?.name || "the customer"} — ${deal.title || "this deal"}.`,
      title: input.title?.trim() || null,
      playbookId: null,
      productIds: input.productIds,
      productHint,
      requirementPdfBase64: input.requirementPdfBase64,
      requirementFilename: input.requirementFilename,
      requirementSource: pdfB64 && meetingNotes?.trim()
        ? "meeting+brd"
        : pdfB64
          ? "brd"
          : "meeting",
    });

    if (!result.ok) {
      return { ok: false, error: result.error };
    }

    notifyAdminsAsync({
      kind: "proposal_created",
      actorUserId: userId,
      dealId: input.dealId,
      dealTitle: deal.title ?? null,
      contactId: deal.contactId ?? null,
      contactName: deal.contactName ?? null,
      companyName: deal.company?.name ?? null,
      ownerUserId: deal.ownerUserId ?? null,
      proposalId: result.id,
      proposalTitle: input.title?.trim() || deal.title,
      href: `/sales/proposals/${result.id}`,
    });

    return {
      ok: true,
      id: result.id,
      ...(result.warnings?.length ? { warnings: result.warnings } : {}),
    };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : "Failed to create proposal.",
    };
  }
}

export async function updateProposalCommand(
  id: string,
  input: {
    title?: string;
    summary?: string | null;
    attachmentUrl?: string | null;
    status?: ProposalStatus;
    sections?: ProposalSection[] | null;
    customerName?: string | null;
  },
): Promise<ProposalCommandResult> {
  try {
    await requireRole(canEditDeals, "You cannot update proposals.");
    const existing = await getProposal(id);
    if (!existing) return { ok: false, error: "Proposal not found." };
    await assertDealAccess(existing.dealId);
    if (input.status === "shared") {
      const { assertDocumentApprovedForSend } = await import(
        "@/service/sales/document-approval"
      );
      const row = await prisma.proposal.findUnique({ where: { id } });
      try {
        assertDocumentApprovedForSend(
          {
            approvedByUserId: row?.approvedByUserId,
            approvedAt: row?.approvedAt,
          },
          "proposal",
        );
      } catch (err) {
        return {
          ok: false,
          error: err instanceof Error ? err.message : "Approval required.",
        };
      }
    }
    if (
      (input.status === "accepted" || input.status === "declined") &&
      existing.status !== "shared"
    ) {
      return {
        ok: false,
        error: "Only shared proposals can be marked accepted or declined.",
      };
    }
    const previousStatus = existing.status;
    const proposal = await updateProposal(id, input);
    if (input.status && input.status !== previousStatus) {
      const kind =
        input.status === "shared"
          ? "proposal_sent"
          : input.status === "accepted"
            ? "proposal_accepted"
            : input.status === "declined"
              ? "proposal_rejected"
              : null;
      if (kind) {
        const userId = await getServerUserId();
        const deal = await getDeal(proposal.dealId);
        notifyAdminsAsync({
          kind,
          actorUserId: userId,
          dealId: proposal.dealId,
          dealTitle: deal?.title ?? null,
          contactId: deal?.contactId ?? null,
          contactName: deal?.contactName ?? null,
          companyName: deal?.company?.name ?? null,
          ownerUserId: deal?.ownerUserId ?? null,
          proposalId: proposal.id,
          proposalTitle: proposal.title,
          href: `/sales/proposals/${proposal.id}`,
        });
        if (
          input.status === "accepted" &&
          deal?.contactId &&
          deal.organizationId
        ) {
          const { triggerLeadLifecycle } = await import(
            "@/service/ai/lead-lifecycle-trigger"
          );
          triggerLeadLifecycle({
            contactId: deal.contactId,
            organizationId: deal.organizationId,
            triggerReason: "proposal_accepted",
          });
        }
      }
    }
    return { ok: true, id: proposal.id };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : "Failed to update proposal.",
    };
  }
}

/** Rewrite one draft proposal section via AI (coworker tool). */
export async function rewriteProposalSectionCommand(
  id: string,
  input: { sectionKey: string; instruction?: string },
): Promise<
  | { ok: true; id: string; warnings?: string[] }
  | { ok: false; error: string; status?: number }
> {
  try {
    await requireRole(canEditDeals, "You cannot update proposals.");
    const existing = await getProposal(id);
    if (!existing) {
      return { ok: false, error: "Proposal not found.", status: 404 };
    }
    await assertDealAccess(existing.dealId);
    if (existing.status !== "draft") {
      return {
        ok: false,
        error: "Only draft proposals can be rewritten.",
        status: 400,
      };
    }
    const sectionKey = input.sectionKey?.trim();
    if (!sectionKey) {
      return { ok: false, error: "sectionKey is required.", status: 400 };
    }

    const resolved = await resolveProposalSectionsWithTemplateFallback({
      dealId: existing.dealId,
      templateId: existing.templateId,
      title: existing.title,
      sectionsRaw: existing.sections,
    });
    const blueprint = parseDocumentBlueprint(existing.blueprint);
    const visibleSections =
      blueprint?.html && isProposalDocHtml(blueprint.html)
        ? sectionsFromProposalDocHtml(blueprint.html, resolved.sections)
        : [];
    const sectionsForRewrite = visibleSections.length
      ? mergeVisibleSectionBodies(resolved.sections, visibleSections)
      : resolved.sections;
    const rewritten = await rewriteProposalSectionBodies({
      sections: sectionsForRewrite,
      sectionKey,
      instruction: input.instruction,
      dealId: existing.dealId,
      templateId: existing.templateId,
      proposalTitle: existing.title,
    });

    if (
      rewritten.warnings.some((w) => w.includes("No section matching"))
    ) {
      return {
        ok: false,
        error: rewritten.warnings[0] || "Section not found.",
        status: 400,
      };
    }

    const cloneSync = await syncPageCloneAfterSectionUpdate({
      proposal: existing,
      sections: rewritten.sections,
    });
    const changed =
      rewritten.sections.find((row) => row.key === sectionKey) ||
      rewritten.sections.find((row, index) => {
        const prev = sectionsForRewrite[index];
        return prev && prev.body !== row.body;
      });
    const htmlSync =
      !cloneSync.blueprint && changed
        ? syncPlaybookHtmlAfterSectionUpdate({
            proposal: existing,
            changed,
          })
        : { warnings: [] as string[] };

    await updateProposal(id, {
      sections: rewritten.sections,
      ...(resolved.bootstrapped
        ? {
            templateId: resolved.draft.templateId,
            blueprint: resolved.draft.blueprint ?? undefined,
            assets: resolved.draft.assets ?? undefined,
          }
        : {}),
      ...(cloneSync.blueprint
        ? {
            blueprint: cloneSync.blueprint,
            assets: cloneSync.assets ?? undefined,
          }
        : htmlSync.blueprint
          ? { blueprint: htmlSync.blueprint }
          : {}),
    });
    const allWarnings = [
      ...rewritten.warnings,
      ...cloneSync.warnings,
      ...htmlSync.warnings,
    ];
    return {
      ok: true,
      id,
      ...(allWarnings.length ? { warnings: allWarnings } : {}),
    };
  } catch (err) {
    return {
      ok: false,
      error:
        err instanceof Error
          ? err.message
          : "Failed to rewrite proposal section.",
    };
  }
}

/** Direct patch of one proposal section title/body (exact text from chat). */
export async function patchProposalSectionCommand(
  id: string,
  input: { sectionKey: string; title?: string; body?: string },
): Promise<{ ok: true; id: string } | { ok: false; error: string; status?: number }> {
  try {
    await requireRole(canEditDeals, "You cannot update proposals.");
    const existing = await getProposal(id);
    if (!existing) {
      return { ok: false, error: "Proposal not found.", status: 404 };
    }
    await assertDealAccess(existing.dealId);
    if (existing.status !== "draft") {
      return {
        ok: false,
        error: "Only draft proposals can be edited.",
        status: 400,
      };
    }
    const key = input.sectionKey?.trim();
    if (!key) {
      return { ok: false, error: "sectionKey is required.", status: 400 };
    }
    const { normalizeProposalSections, parseProposalSections, resolveDocumentSection, DOCUMENT_SECTION_ALIASES } =
      await import("@/lib/proposal-sections");
    const sections = normalizeProposalSections(
      parseProposalSections(existing.sections),
    );
    const match = resolveDocumentSection(sections, key, DOCUMENT_SECTION_ALIASES);
    if (!match) {
      return { ok: false, error: `No section matching “${key}”.`, status: 400 };
    }
    const idx = sections.findIndex((s) => s.id === match.id);
    const next = { ...sections[idx]! };
    if (typeof input.title === "string" && input.title.trim()) {
      next.title = input.title.trim().slice(0, 200);
    }
    if (typeof input.body === "string") {
      next.body = input.body.trim().slice(0, 8000);
    }
    if (next.body === sections[idx]!.body && next.title === sections[idx]!.title) {
      return { ok: false, error: "Nothing to update.", status: 400 };
    }
    const merged = sections.slice();
    merged[idx] = next;
    const cloneSync = await syncPageCloneAfterSectionUpdate({
      proposal: existing,
      sections: merged,
    });
    const htmlSync = !cloneSync.blueprint
      ? syncPlaybookHtmlAfterSectionUpdate({
          proposal: existing,
          changed: next,
        })
      : { warnings: [] as string[] };
    await updateProposal(id, {
      sections: merged,
      ...(cloneSync.blueprint
        ? {
            blueprint: cloneSync.blueprint,
            assets: cloneSync.assets ?? undefined,
          }
        : htmlSync.blueprint
          ? { blueprint: htmlSync.blueprint }
          : {}),
    });
    const htmlWarnings = htmlSync.warnings ?? [];
    return {
      ok: true,
      id,
      ...(cloneSync.warnings.length || htmlWarnings.length
        ? { warnings: [...cloneSync.warnings, ...htmlWarnings] }
        : {}),
    };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : "Failed to update section.",
    };
  }
}

/** Patch visible proposal text (cover date, header, body) without changing layout. */
export async function patchProposalDocumentTextCommand(
  id: string,
  input: {
    textReplacements: Array<{ find: string; replace?: string }>;
    pageId?: string | null;
    removeImageAssetIds?: string[] | null;
    tableBorders?: boolean | null;
  },
): Promise<
  | { ok: true; id: string; applied: number }
  | { ok: false; error: string; status?: number }
> {
  try {
    await requireRole(canEditDeals, "You cannot update proposals.");
    const existing = await getProposal(id);
    if (!existing) {
      return { ok: false, error: "Proposal not found.", status: 404 };
    }
    await assertDealAccess(existing.dealId);
    if (existing.status !== "draft") {
      return {
        ok: false,
        error: "Only draft proposals can be edited.",
        status: 400,
      };
    }
    const {
      applyDocumentTextReplacements,
      assertDocumentTextEditable,
    } = await import("@/service/sales/document-text-patch");
    const editable = assertDocumentTextEditable(existing.blueprint);
    if (!editable.ok) {
      return { ok: false, error: editable.error, status: 400 };
    }
    const textReplacements = (input.textReplacements ?? [])
      .map((row) => ({
        find: row.find?.trim() ?? "",
        replace: row.replace ?? "",
      }))
      .filter((row) => row.find.length > 0);
    const hasTableBorderAction = typeof input.tableBorders === "boolean";
    if (
      !textReplacements.length &&
      !(input.removeImageAssetIds ?? []).length &&
      !hasTableBorderAction
    ) {
      return {
        ok: false,
        error: "At least one text replacement, tableBorders, or removeImageAssetIds entry is required.",
        status: 400,
      };
    }
    const patched = applyDocumentTextReplacements({
      blueprint: existing.blueprint,
      assets: existing.assets,
      textReplacements,
      pageId: input.pageId ?? null,
      removeImageAssetIds: input.removeImageAssetIds ?? null,
      tableBorders: hasTableBorderAction ? input.tableBorders : null,
    });
    if (patched.applied === 0) {
      return {
        ok: false,
        error: "No matching text found on the selected page(s).",
        status: 400,
      };
    }
    await updateProposal(id, {
      blueprint: patched.blueprint ?? undefined,
      assets: patched.assets,
    });
    return { ok: true, id, applied: patched.applied };
  } catch (err) {
    return {
      ok: false,
      error:
        err instanceof Error ? err.message : "Failed to update document text.",
    };
  }
}

/** Persist inline edits on a frozen `.proposal-doc` preview (zip-style). */
export async function patchProposalBlueprintHtmlCommand(
  id: string,
  html: string,
): Promise<{ ok: true; id: string } | { ok: false; error: string; status?: number }> {
  try {
    await requireRole(canEditDeals, "You cannot update proposals.");
    const existing = await getProposal(id);
    if (!existing) {
      return { ok: false, error: "Proposal not found.", status: 404 };
    }
    await assertDealAccess(existing.dealId);
    if (existing.status !== "draft") {
      return {
        ok: false,
        error: "Only draft proposals can be edited.",
        status: 400,
      };
    }
    const blueprint = parseDocumentBlueprint(existing.blueprint);
    if (!blueprint || !isProposalDocHtml(blueprint.html)) {
      return {
        ok: false,
        error: "This proposal is not an editable generated document.",
        status: 400,
      };
    }
    const nextHtml = mergeProposalDocHtml(blueprint.html, html);
    const sections = sectionsFromProposalDocHtml(
      nextHtml,
      parseProposalSections(existing.sections),
    );
    await updateProposal(id, {
      blueprint: { ...blueprint, html: nextHtml },
      sections,
    });
    return { ok: true, id };
  } catch (err) {
    return {
      ok: false,
      error:
        err instanceof Error ? err.message : "Failed to save document edits.",
    };
  }
}

export {
  updateProposalDocumentAssetCommand,
} from "@/service/sales/document-asset-update";

function readStoredPlaybookId(blueprint: unknown): string | null {
  if (!blueprint || typeof blueprint !== "object" || Array.isArray(blueprint)) {
    return null;
  }
  const raw = (blueprint as Record<string, unknown>).playbookId;
  const id = typeof raw === "string" ? raw.trim() : "";
  return id || null;
}

/** Rewrite draft proposal section bodies for the linked deal; refresh cover visuals. */
export async function personalizeProposalCommand(
  id: string,
  input?: {
    productIds?: string[] | null;
    productHint?: string | null;
    /** When omitted, reuse blueprint.playbookId so regenerate does not rematch. */
    playbookId?: string | null;
    requirementPdfBase64?: string | null;
    requirementFilename?: string | null;
  },
): Promise<
  | { ok: true; id: string; warnings?: string[] }
  | { ok: false; error: string; status?: number }
> {
  try {
    await requireRole(canEditDeals, "You cannot update proposals.");
    const existing = await getProposal(id);
    if (!existing) {
      return { ok: false, error: "Proposal not found.", status: 404 };
    }
    await assertDealAccess(existing.dealId);
    if (existing.status !== "draft") {
      return {
        ok: false,
        error: "Only draft proposals can be regenerated.",
        status: 400,
      };
    }

    const meetingNotes = await loadMeetingNotesForDeal(existing.dealId);
    const productHint = input?.productHint?.trim() || null;
    const storedBrd = readStoredProposalRequirement(existing.blueprint);
    const pdfB64 = input?.requirementPdfBase64?.trim() || "";
    if (!storedBrd && !pdfB64 && !(meetingNotes && meetingNotes.trim().length >= 40)) {
      return {
        ok: false,
        error:
          "This draft has no saved customer BRD. Attach the requirement file (PDF, Word, or text) and click Regenerate — refreshing the page will not rewrite the document.",
        status: 400,
      };
    }

    const pinnedPlaybookId =
      input?.playbookId?.trim() ||
      readStoredPlaybookId(existing.blueprint) ||
      null;

    const result = await createProposalFromPlaybookCommand({
      dealId: existing.dealId,
      requirementText: storedBrd || "",
      productIds: input?.productIds ?? null,
      productHint,
      playbookId: pinnedPlaybookId,
      replaceProposalId: id,
      requirementPdfBase64: pdfB64 || null,
      requirementFilename: input?.requirementFilename?.trim() || null,
      requirementSource: storedBrd || pdfB64
        ? meetingNotes?.trim()
          ? "meeting+brd"
          : "brd"
        : meetingNotes?.trim()
          ? "meeting"
          : "manual",
    });

    if (!result.ok) {
      return { ok: false, error: result.error };
    }

    return {
      ok: true,
      id: result.id,
      ...(result.warnings?.length ? { warnings: result.warnings } : {}),
    };
  } catch (err) {
    return {
      ok: false,
      error:
        err instanceof Error
          ? err.message
          : "Failed to personalize proposal.",
    };
  }
}

export async function shareProposalCommand(
  id: string,
): Promise<ProposalCommandResult> {
  return updateProposalCommand(id, { status: "shared" });
}

export async function sendProposalCommand(
  id: string,
): Promise<ProposalCommandResult> {
  try {
    await requireRole(canEditDeals, "You cannot send proposals.");
    const existing = await getProposal(id);
    if (!existing) return { ok: false, error: "Proposal not found." };
    await assertDealAccess(existing.dealId);
    if (existing.status !== "draft") {
      return { ok: false, error: "Only draft proposals can be sent." };
    }

    const userId = await getServerUserId();
    if (!userId) {
      return { ok: false, error: "Sign in again to send the proposal." };
    }

    const row = await prisma.proposal.findUnique({ where: { id } });
    const { assertDocumentApprovedForSend } =
      await import("@/service/sales/document-approval");
    try {
      assertDocumentApprovedForSend(
        {
          approvedByUserId:
            row?.approvedByUserId != null
              ? String(row.approvedByUserId)
              : null,
          approvedAt: row?.approvedAt,
        },
        "proposal",
      );
    } catch (err) {
      return {
        ok: false,
        error:
          err instanceof Error
            ? err.message
            : "This proposal must be approved before it can be sent.",
      };
    }
    try {
      const { getRunByProposalId } = await import(
        "@/dao/sales/proposal-generation-run"
      );
      const orgId = existing.organizationId;
      const run = await getRunByProposalId(id, String(orgId));
      const issues = run?.pricingIssues as { sendBlocked?: boolean } | null;
      if (issues?.sendBlocked) {
        return {
          ok: false,
          error:
            "Pricing is incomplete. Confirm catalog prices and quantities before sending.",
        };
      }
    } catch {
      // V2 tables may be absent until migrate.
    }

    let pdfAttachment: { filename: string; buffer: Buffer } | null = null;
    const pdf = await getProposalPdfCommand(id);
    if (pdf.ok) {
      pdfAttachment = { filename: pdf.filename, buffer: pdf.buffer };
    } else if (!existing.attachmentUrl?.trim()?.startsWith("http")) {
      return {
        ok: false,
        error:
          pdf.error ||
          "Could not generate a proposal PDF. Run: npx playwright install chromium (in backend/), then try again.",
      };
    }

    const { proposal, emailWarning } = await markProposalSent(
      id,
      userId,
      pdfAttachment,
    );

    const deal = await getDeal(proposal.dealId);
    notifyAdminsAsync({
      kind: "proposal_sent",
      actorUserId: userId,
      dealId: proposal.dealId,
      dealTitle: deal?.title ?? null,
      contactId: deal?.contactId ?? null,
      contactName: deal?.contactName ?? null,
      companyName: deal?.company?.name ?? null,
      ownerUserId: deal?.ownerUserId ?? null,
      proposalId: proposal.id,
      proposalTitle: proposal.title,
      href: `/sales/proposals/${proposal.id}`,
    });

    const warning =
      emailWarning ||
      undefined;

    return {
      ok: true,
      id: proposal.id,
      ...(warning ? { warning } : {}),
    };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : "Failed to send proposal.",
    };
  }
}

/** Re-email a shared proposal with PDF (corrects prior sends missing attachment). */
export async function resendProposalCommand(
  id: string,
): Promise<ProposalCommandResult> {
  try {
    await requireRole(canEditDeals, "You cannot send proposals.");
    const existing = await getProposal(id);
    if (!existing) return { ok: false, error: "Proposal not found." };
    await assertDealAccess(existing.dealId);
    if (existing.status !== "shared") {
      return {
        ok: false,
        error: "Only shared proposals can be re-sent. Use Send on a draft first.",
      };
    }

    const userId = await getServerUserId();
    if (!userId) {
      return { ok: false, error: "Sign in again to send the proposal." };
    }

    const to = existing.deal.contactEmail?.trim();
    if (!to) {
      return { ok: false, error: "No contact email on the deal." };
    }

    const pdf = await getProposalPdfCommand(id);
    if (!pdf.ok) {
      return {
        ok: false,
        error:
          pdf.error ||
          "Could not generate a proposal PDF. Run: npx playwright install chromium (in backend/), then try again.",
      };
    }

    const { emailProposalToContact } = await import(
      "@/dao/sales/proposal-service"
    );
    const emailed = await emailProposalToContact({
      proposalNumber: existing.number,
      proposalTitle: existing.title,
      dealTitle: existing.deal.title,
      contactName: existing.deal.contactName,
      contactEmail: to,
      contactId: existing.deal.contactId,
      organizationId: existing.organizationId,
      actorUserId: userId,
      attachment: { filename: pdf.filename, buffer: pdf.buffer },
      attachmentUrl: existing.attachmentUrl,
    });

    if (!emailed.ok) {
      return {
        ok: false,
        error: emailed.needsConnect
          ? "Connect email in Configuration to deliver to the customer."
          : emailed.error,
      };
    }

    return { ok: true, id: existing.id };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : "Failed to resend proposal.",
    };
  }
}

export async function createProposalVersionCommand(
  id: string,
): Promise<ProposalCommandResult> {
  try {
    await requireRole(canEditDeals, "You cannot create proposal versions.");
    const existing = await getProposal(id);
    if (!existing) return { ok: false, error: "Proposal not found." };
    await assertDealAccess(existing.dealId);
    const proposal = await createProposalVersion(id);
    return { ok: true, id: proposal.id };
  } catch (err) {
    return {
      ok: false,
      error:
        err instanceof Error ? err.message : "Failed to create new version.",
    };
  }
}

export async function deleteProposalCommand(
  id: string,
): Promise<ProposalCommandResult> {
  try {
    await requireRole(canEditDeals, "You cannot delete proposals.");
    const existing = await getProposal(id);
    if (!existing) return { ok: false, error: "Proposal not found." };
    await assertDealAccess(existing.dealId);
    await deleteProposal(id);
    return { ok: true, id };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : "Failed to delete proposal.",
    };
  }
}

export async function listProposalTemplatesCommand() {
  try {
    await requireRole(canEditDeals);
    await ensureDefaultProposalTemplate();
    const items = await listProposalTemplates();
    return { ok: true as const, items };
  } catch (err) {
    return {
      ok: false as const,
      error: err instanceof Error ? err.message : "Failed to load templates.",
    };
  }
}

export async function getProposalTemplateCommand(id: string) {
  try {
    await requireRole(canEditDeals);
    const template = await getProposalTemplate(id);
    if (!template) {
      return { ok: false as const, error: "Template not found.", status: 404 };
    }
    return { ok: true as const, template };
  } catch (err) {
    return {
      ok: false as const,
      error: err instanceof Error ? err.message : "Failed to load template.",
    };
  }
}

export async function createProposalTemplateCommand(input: {
  name: string;
  sections?: ProposalSection[];
  makeActive?: boolean;
  blueprint?: unknown;
  assets?: unknown;
}) {
  try {
    await requireRole(
      canManageDocumentTemplates,
      "You cannot create proposal templates.",
    );
    const template = await createProposalTemplate({
      name: input.name,
      sections: input.sections,
      makeActive: input.makeActive,
      blueprint: parseDocumentBlueprint(input.blueprint),
      assets: parseBlueprintAssetsStrict(input.assets),
    });
    return { ok: true as const, id: template.id, template };
  } catch (err) {
    return {
      ok: false as const,
      error: err instanceof Error ? err.message : "Failed to create template.",
    };
  }
}

export async function updateProposalTemplateCommand(
  id: string,
  input: {
    name?: string;
    sections?: ProposalSection[];
    isDefault?: boolean;
    blueprint?: unknown;
    assets?: unknown;
  },
) {
  try {
    await requireRole(
      canManageDocumentTemplates,
      "You cannot edit proposal templates.",
    );
    const template = await updateProposalTemplate(id, {
      name: input.name,
      sections: input.sections,
      isDefault: input.isDefault,
      ...(input.blueprint !== undefined
        ? { blueprint: parseDocumentBlueprint(input.blueprint) }
        : {}),
      ...(input.assets !== undefined
        ? { assets: parseBlueprintAssetsStrict(input.assets) }
        : {}),
    });
    return { ok: true as const, id: template.id, template };
  } catch (err) {
    return {
      ok: false as const,
      error: err instanceof Error ? err.message : "Failed to update template.",
    };
  }
}

export async function deleteProposalTemplateCommand(id: string) {
  try {
    await requireRole(
      canManageDocumentTemplates,
      "You cannot delete proposal templates.",
    );
    await deleteProposalTemplate(id);
    return { ok: true as const, id };
  } catch (err) {
    return {
      ok: false as const,
      error: err instanceof Error ? err.message : "Failed to delete template.",
    };
  }
}
