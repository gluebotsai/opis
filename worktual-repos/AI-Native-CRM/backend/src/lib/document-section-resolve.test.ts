/**
 * Run: npx tsx src/lib/document-section-resolve.test.ts
 */
import { defaultStandardProposalSections } from "./proposal-sections";
import { defaultStandardQuoteSections } from "./quote-document-sections";
import { resolveDocumentSection, DOCUMENT_SECTION_ALIASES } from "./document-section-resolve";

function assert(cond: unknown, msg: string) {
  if (!cond) throw new Error(msg);
}

const proposalSections = defaultStandardProposalSections();
const quoteSections = defaultStandardQuoteSections();

assert(
  resolveDocumentSection(proposalSections, "implementation_plan", DOCUMENT_SECTION_ALIASES)
    ?.key === "implementation",
  "proposal implementation_plan",
);
assert(
  resolveDocumentSection(proposalSections, "key product features", DOCUMENT_SECTION_ALIASES)
    ?.key === "features",
  "proposal features alias",
);
assert(
  resolveDocumentSection(quoteSections, "payment_terms", DOCUMENT_SECTION_ALIASES)?.key ===
    "payment_terms",
  "quote payment_terms key",
);
assert(
  resolveDocumentSection(quoteSections, "bank details", DOCUMENT_SECTION_ALIASES)?.key ===
    "bank",
  "quote bank details",
);
assert(
  resolveDocumentSection(quoteSections, "terms and conditions", DOCUMENT_SECTION_ALIASES)
    ?.key === "terms",
  "quote terms alias",
);
assert(
  resolveDocumentSection(quoteSections, "enhance the delivery timeline", DOCUMENT_SECTION_ALIASES)
    ?.key === "delivery",
  "quote delivery partial hint",
);

console.log("document-section-resolve.test.ts ok");
