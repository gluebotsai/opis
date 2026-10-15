/**
 * Rewrite a single quote document section via the proposal-content LLM agent.
 */

import {
  parseQuoteDocumentSections,
  type QuoteDocumentSection,
} from "@/lib/quote-document-sections";
import { getQuote } from "@/dao/sales/quote-service";
import { rewriteProposalSectionBodies } from "@/service/sales/proposal-section-rewrite";
import type { ProposalSection } from "@/lib/proposal-sections";

function toProposalSections(rows: QuoteDocumentSection[]): ProposalSection[] {
  return rows.map((s) => ({
    id: s.id,
    key: s.key,
    title: s.title,
    body: s.body,
    sortOrder: s.sortOrder,
  }));
}

function toQuoteSections(rows: ProposalSection[]): QuoteDocumentSection[] {
  return rows.map((s) => ({
    id: s.id,
    key: s.key,
    title: s.title,
    body: s.body,
    sortOrder: s.sortOrder,
  }));
}

export async function rewriteQuoteSectionBodies(input: {
  quoteId: string;
  sectionKey: string;
  instruction?: string;
}): Promise<{ sections: QuoteDocumentSection[]; warnings: string[] }> {
  const quote = await getQuote(input.quoteId);
  if (!quote) {
    return { sections: [], warnings: ["Quote not found."] };
  }
  const sections = parseQuoteDocumentSections(quote.documentSections);
  const rewritten = await rewriteProposalSectionBodies({
    sections: toProposalSections(sections),
    sectionKey: input.sectionKey,
    instruction: input.instruction,
    dealId: quote.dealId,
    templateId: quote.templateId,
    proposalTitle: quote.number,
  });
  return {
    sections: toQuoteSections(rewritten.sections),
    warnings: rewritten.warnings,
  };
}
