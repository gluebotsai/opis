/**
 * Rewrite a single proposal section body for the linked deal (AI + optional instruction).
 */

import {
  normalizeProposalSections,
  resolveDocumentSection,
  DOCUMENT_SECTION_ALIASES,
  type ProposalSection,
} from "@/lib/proposal-sections";
import { prepareProposalFromTemplate } from "@/dao/sales/proposal-service";
import { personalizeProposalSections } from "@/service/sales/proposal-personalize";
import { resolveDealProposalCatalog } from "@/service/sales/proposal-visuals";
import { loadMeetingNotesForDeal } from "@/service/ai/proposal-brief";

export async function rewriteProposalSectionBodies(input: {
  sections: ProposalSection[];
  sectionKey: string;
  instruction?: string;
  dealId: string;
  templateId?: string | null;
  proposalTitle?: string | null;
}): Promise<{ sections: ProposalSection[]; warnings: string[] }> {
  const warnings: string[] = [];
  const sections = normalizeProposalSections(input.sections);
  const target = resolveDocumentSection(
    sections,
    input.sectionKey,
    DOCUMENT_SECTION_ALIASES,
  );
  if (!target) {
    return {
      sections,
      warnings: [`No section matching “${input.sectionKey}” found.`],
    };
  }

  let draftContext: Awaited<
    ReturnType<typeof prepareProposalFromTemplate>
  >["context"] | null = null;
  let organizationId: string | null = null;
  let vendorName = "";
  try {
    const draft = await prepareProposalFromTemplate({
      dealId: input.dealId,
      templateId: input.templateId,
      title: input.proposalTitle,
    });
    draftContext = draft.context;
    organizationId = draft.organizationId;
    vendorName = draft.vendorName;
  } catch {
    draftContext = null;
  }

  if (!draftContext || !organizationId) {
    warnings.push("Could not load deal context; section left unchanged.");
    return { sections, warnings };
  }

  const catalog = await resolveDealProposalCatalog({
    dealId: input.dealId,
    organizationId,
    dealTitle: draftContext.dealTitle,
    dealNotes: draftContext.dealNotes,
  });

  const meetingNotes = await loadMeetingNotesForDeal(input.dealId);

  const result = await personalizeProposalSections({
    sections: [target],
    context: {
      ...draftContext,
      dealNotes: [draftContext.dealNotes, meetingNotes]
        .filter(Boolean)
        .join("\n\n"),
      productName: catalog.product?.name ?? null,
      product: catalog.product
        ? {
            name: catalog.product.name,
            tagline: catalog.product.tagline,
            description: catalog.product.description,
            specifications: catalog.product.specifications,
            sku: catalog.product.sku,
            price: catalog.product.price,
            currency: catalog.product.currency,
            category: catalog.product.category,
          }
        : null,
      quoteLines: catalog.quoteLines,
      authorDirection: [
        "SURGICAL EDIT — keep the existing section body.",
        "Apply ONLY this user request: "
          + (input.instruction?.trim()
            || "Improve clarity only; do not add new claims."),
        "Do not invent products, capabilities, headings, or commercials that are not already in the body.",
        "If the request is bullets, numbering, lists, tone, or a professional rewrite, reformat this text only.",
        "Use an opening paragraph, '## Title Case' subheadings (never ALL CAPS), and '- ' bullets for capabilities.",
        "",
        "Existing body:",
        target.body,
      ].join("\n"),
    },
    vendorName,
  });
  warnings.push(...result.warnings);

  const rewritten = result.sections[0];
  if (!rewritten?.body?.trim()) {
    warnings.push("AI rewrite unavailable; section left unchanged.");
    return { sections, warnings };
  }

  const next = sections.map((s) =>
    s.id === target.id
      ? { ...s, title: rewritten.title?.trim() || s.title, body: rewritten.body }
      : s,
  );
  return { sections: next, warnings };
}
