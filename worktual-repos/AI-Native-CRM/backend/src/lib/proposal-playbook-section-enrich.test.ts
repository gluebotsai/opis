/**
 * run: npx tsx src/lib/proposal-playbook-section-enrich.test.ts
 */
import {
  collectProposalDeepSections,
  enrichPlaybookSectionsFromPairs,
} from "./proposal-playbook-section-enrich";

function assert(cond: unknown, msg: string) {
  if (!cond) throw new Error(msg);
}

const pairPayload = [
  {
    proposal: {
      sectionOrder: ["executive_summary", "pricing_monthly"],
      sections: [
        {
          key: "executive_summary",
          title: "Executive Summary",
          intent: "Frame options",
          tone: "formal",
          typicalLength: "medium",
          contentPattern:
            "Open with a two-option framing paragraph that names the Requested Solution and Recommended Solution with enough detail for a writer to reproduce the section structure.",
        },
        {
          key: "pricing_monthly",
          title: "Pricing — Monthly Recurring Charges",
          intent: "Show recurring fees",
          tone: "formal",
          typicalLength: "medium",
          contentPattern:
            "Open with a two-level heading, then present a side-by-side comparison table with requested and recommended monthly charges including discounts and footnotes.",
        },
      ],
    },
  },
];

const thinEnriched = enrichPlaybookSectionsFromPairs({
  learnedSections: [
    {
      key: "introduction",
      title: "Introduction",
      intent: "Open",
      tone: "formal",
      typicalLength: "medium",
      contentPattern: "Short.",
    },
    {
      key: "commercials",
      title: "Commercials",
      intent: "Price",
      tone: "formal",
      typicalLength: "medium",
      contentPattern: "",
    },
  ],
  pairPayload,
});
assert(thinEnriched.length >= 2, "backfill keeps at least two sections");
assert(
  thinEnriched.every((s) => String(s.contentPattern || "").trim().length >= 40),
  "every section has an actionable contentPattern",
);

const emptyEnriched = enrichPlaybookSectionsFromPairs({
  learnedSections: [],
  pairPayload,
});
assert(emptyEnriched.length === 2, "empty synthesize falls back to deep-reads");
assert(collectProposalDeepSections(pairPayload).length === 2, "deep-reads collect both sections");

const truncatedPairs = [
  {
    proposal: {
      sectionOrder: [
        "requested_solution",
        "one_time_charges",
        "note_for_client",
        "assumptions",
      ],
      sections: [
        {
          key: "requested_solution",
          title: "1. Requested Solution — As specified by Purity Harvest",
          intent: "Describe the requested option as specified by Purity Harvest",
          tone: "formal",
          typicalLength: "medium",
          contentPattern:
            "Open with the requested solution heading, then a capability comparison table with requested vs recommended columns and a closing note on scope.",
        },
        {
          key: "one_time_charges",
          title: "One-time charges",
          intent: "Show one-time fees",
          tone: "formal",
          typicalLength: "medium",
          contentPattern:
            "Present a line-item table of one-time charges with item, quantity, and amount columns, then a total row.",
        },
        {
          key: "note_for_client",
          title: "Note for client",
          intent: "Clarify commercial caveats",
          tone: "formal",
          typicalLength: "short",
          contentPattern:
            "A short closing note that commercials are estimates and depend on the signed statement of work.",
        },
        {
          key: "assumptions",
          title: "Assumptions",
          intent: "List delivery assumptions",
          tone: "formal",
          typicalLength: "medium",
          contentPattern:
            "Bullet the delivery assumptions in the same order as the source, without naming the historical customer.",
        },
      ],
    },
  },
];

const recovered = enrichPlaybookSectionsFromPairs({
  learnedSections: [
    {
      key: "requested_solution",
      title: "1. Requested Solution — As specified by Purity Harvest",
      intent: "Describe requested option",
      tone: "formal",
      typicalLength: "medium",
      contentPattern:
        "Open with the requested solution heading, then a capability comparison table.",
    },
    {
      key: "one_time_charges",
      title: "One-time charges",
      intent: "Show one-time fees",
      tone: "formal",
      typicalLength: "medium",
      contentPattern: "Present a truncated table of",
    },
  ],
  pairPayload: truncatedPairs,
});
const keys = recovered.map((s) => String(s.key));
assert(keys.includes("note_for_client"), "missing note_for_client is backfilled");
assert(keys.includes("assumptions"), "missing assumptions is backfilled");
const requested = recovered.find((s) => s.key === "requested_solution");
assert(
  !/Purity Harvest/i.test(String(requested?.title || "")),
  "customer name stripped from title",
);
assert(String(requested?.title || "") === "Requested Solution", "title is reusable");

console.log("proposal-playbook-section-enrich.test.ts ok");
