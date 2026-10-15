/**
 * run: npx tsx src/service/sales/proposal-from-playbook-commands.test.ts
 */
import {
  buildProposalRegenerateRequirement,
  composeProposalRequirement,
  playbookPatternForGeneration,
  readStoredProposalRequirement,
  selectLearnedPlaybookId,
} from "./proposal-from-playbook-commands";
import {
  gateProposalSectionsAgainstAllowedProducts,
  heuristicClusterProposals,
} from "@/lib/proposal-playbook-pattern";
import { retrieveTopPlaybooks } from "@/lib/proposal-playbook-retrieve";
import { playbookVisualTemplateReady } from "@/lib/proposal-playbook-layout";

function assert(cond: unknown, msg: string) {
  if (!cond) throw new Error(msg);
}

const stripped = playbookPatternForGeneration({
  id: "pb1",
  name: "Telco pattern",
  tags: ["telecom"],
  tagsJson: {},
  pricingShape: "line_items",
  overallTone: "formal",
  layoutStyle: null,
  sections: [
    {
      key: "introduction",
      title: "Introduction",
      intent: "Open with customer context",
      contentPattern: "Vendor greeting then customer pain",
      body: "Old PDF paragraph that must not leak",
      sampleText: "Acme Corp needs CRM",
    },
  ],
  sectionsJson: [],
  sourceBatchId: "batch-1",
  contentPlaybookId: null,
  updatedAt: null,
  blueprint: null,
  assets: null,
});

const intro = stripped.sections[0] as Record<string, unknown>;
assert(intro.contentPattern, "keeps contentPattern");
assert(!("body" in intro), "strips historical body");
assert(!("sampleText" in intro), "strips sampleText");
assert(stripped.format, "exposes format");
assert(stripped.content, "exposes content");

const mixed = heuristicClusterProposals([
  { itemId: "purity", coverStyle: "left", pricingShape: "line_items" },
  { itemId: "orange", coverStyle: "banner", pricingShape: "tiered" },
]);
assert(mixed.length === 2, "mixed styles cluster separately");

const gated = gateProposalSectionsAgainstAllowedProducts({
  sections: [{ body: "Recommend CDP and CVM with CRM" }],
  allowedProducts: ["Worktual CCaaS", "AI Native CRM"],
});
assert(!/CDP/i.test(gated.sections[0]?.body || ""), "strips CDP");
assert(!/\bCVM\b/i.test(gated.sections[0]?.body || ""), "strips CVM");

const gatedRows = gateProposalSectionsAgainstAllowedProducts({
  sections: [
    {
      body: "Pricing for CCaaS.",
      tableRows: [{ cells: ["CVM", "Worktual CCaaS"] }],
    },
  ],
  allowedProducts: ["Worktual CCaaS"],
});
const cells = (
  gatedRows.sections[0] as { tableRows?: Array<{ cells: string[] }> }
).tableRows?.[0]?.cells;
assert(cells && !/\bCVM\b/i.test(cells[0] || ""), "strips CVM from table cells");
assert(/CCaaS/i.test(cells?.[1] || ""), "keeps allowed product in table cells");

const withSchema = playbookPatternForGeneration({
  id: "pb2",
  name: "Comparison pattern",
  tags: ["ccaas"],
  tagsJson: {
    format: { coverStyle: "left", headingColor: "#123456" },
    content: {
      featureSchema: {
        tables: [{ key: "comparison", columns: ["Capability", "Requested"] }],
        requestedFeatures: ["omnichannel"],
      },
    },
  },
  pricingShape: "line_items",
  overallTone: "formal",
  layoutStyle: null,
  sections: [{ key: "comparison", title: "Comparison" }],
  sectionsJson: [],
  sourceBatchId: "batch-2",
  contentPlaybookId: null,
  updatedAt: null,
  blueprint: { mode: "playbook-template", html: "<div></div>", css: "x" },
  assets: null,
});
assert(
  (withSchema.content.featureSchema as { requestedFeatures?: string[] })
    ?.requestedFeatures?.[0] === "omnichannel",
  "preserves featureSchema",
);
assert(
  !playbookVisualTemplateReady({
    mode: "playbook-template",
    html: "<div></div>",
    css: "x",
  }),
  "empty playbook-template html is not ready for generate",
);

const cards = retrieveTopPlaybooks(
  { themes: ["ccaas"], products: ["crm"], summary: "CCaaS and CRM" },
  [
    {
      id: "raster",
      name: "Old clone",
      tagsJson: { tags: ["ccaas"] },
      sourceBatchId: "b1",
      blueprint: { mode: "page-clone" },
      assets: [{ id: "page-1" }],
    },
    {
      id: "format",
      name: "Consultative CCaaS",
      tagsJson: {
        tags: ["ccaas", "crm"],
        layoutStyle: { source: "minimax_design" },
      },
      sourceBatchId: "b2",
    },
  ],
);
assert(cards[0]?.id === "format", "does not boost visual master");

const regenReq = buildProposalRegenerateRequirement({
  productHint: "CCaaS and CRM only",
  meetingNotes: "Discussed CCaaS and CRM",
  dealTitle: "crm",
  companyName: "Purity Harvest",
});
assert(!/CDP/i.test(regenReq), "regenerate requirement omits old CDP title");
assert(!/Campaign/i.test(regenReq), "regenerate requirement omits old campaign title");
assert(/CCaaS/.test(regenReq), "keeps product hint");

const composed = composeProposalRequirement({
  meetingNotes: "They prefer CCaaS and CRM.",
  requirementText: "BRD: 50 seats, English + Hindi.",
});
assert(/MEETING NOTES/.test(composed), "labels meeting notes");
assert(/CUSTOMER REQUIREMENT/.test(composed), "labels BRD");
assert(/50 seats/.test(composed), "keeps BRD text");

const storedBrd = readStoredProposalRequirement({
  html: "<div></div>",
  requirementText: "Positron - BRD: Lola Voicebot, 50 seats, English + Hindi.",
});
assert(
  /Lola Voicebot/.test(storedBrd || ""),
  "regenerate reads the original BRD from the proposal, not the deal title",
);
const regenWithoutDealTitle = composeProposalRequirement({
  meetingNotes: "They prefer CCaaS.",
  requirementText: storedBrd,
});
assert(/Lola Voicebot/.test(regenWithoutDealTitle), "composed regenerate keeps stored BRD");
assert(
  !/gugan s/i.test(regenWithoutDealTitle),
  "deal-title crumbs stay out of the regenerate requirement",
);

assert(
  selectLearnedPlaybookId({
    matchId: "zifo",
    shortlistIds: ["zifo"],
    approvedIds: ["zifo"],
  }) === "zifo",
  "uses the only approved playbook even when topical overlap is weak",
);
assert(
  selectLearnedPlaybookId({
    requestedId: "missing",
    matchId: null,
    shortlistIds: ["zifo"],
    approvedIds: ["zifo"],
  }) === "zifo",
  "falls back to shortlist when requested id is gone",
);
assert(
  selectLearnedPlaybookId({
    matchId: "zifo",
    shortlistIds: ["zifo"],
    approvedIds: [],
  }) === null,
  "no playbook when none are approved",
);

console.log("proposal-from-playbook-commands.test.ts ok");
