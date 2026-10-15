/**
 * Lightweight unit checks (run: npx tsx src/lib/proposal-playbook-align.test.ts)
 */
import {
  alignPlaybookToTemplate,
  parsePlaybookMeta,
  parsePlaybookSections,
  snippetPlain,
} from "./proposal-playbook-align";

function assert(cond: unknown, msg: string) {
  if (!cond) throw new Error(msg);
}

const playbook = parsePlaybookSections([
  { key: "commercial_proposal", title: "Commercial Proposal" },
  { key: "overview", title: "Overview" },
  { key: "requested", title: "Requested Solution" },
  { key: "current", title: "Considerations with the Current Approach" },
  { key: "recommended", title: "Recommended Solution" },
  { key: "comparison", title: "Requested vs Recommended Comparison" },
  { key: "commercials", title: "Commercial Terms" },
  { key: "assumptions", title: "Assumptions" },
  { key: "conclusion", title: "Conclusion" },
]);
assert(playbook.length === 9, "parses nine playbook sections");

const template = [
  { key: "introduction", title: "Introduction", body: "<p>Hello</p>" },
  { key: "scope", title: "Scope of Work", body: "Deliverables" },
  { key: "features", title: "Solution Features" },
  { key: "commercials", title: "Commercials" },
  { key: "legal", title: "Legal terms" },
  { key: "conclusion", title: "Next Steps" },
];

const aligned = alignPlaybookToTemplate(playbook, template);
assert(aligned.playbookCount === 9, "playbook count");
assert(aligned.templateCount === 6, "template count");
assert(aligned.matched >= 4, `expected several matches, got ${aligned.matched}`);
assert(aligned.templateOnly >= 1, "legal stays template-only");
assert(
  aligned.rows.some(
    (r) => r.kind === "template_only" && r.template?.title === "Legal terms",
  ),
  "legal appears as only-in-template",
);
assert(
  aligned.rows.some(
    (r) =>
      r.playbook?.title === "Commercial Terms" &&
      r.template?.title === "Commercials",
  ),
  "commercials map across renamed headings",
);
assert(
  aligned.rows.some(
    (r) =>
      r.playbook?.title === "Requested vs Recommended Comparison" &&
      r.kind === "playbook_only",
  ),
  "comparison heading stays new unless the template has a comparison section",
);
assert(
  aligned.rows.some(
    (r) =>
      r.playbook?.title === "Commercial Proposal" && r.kind === "playbook_only",
  ),
  "cover title does not steal the introduction match",
);
assert(
  aligned.rows.some(
    (r) =>
      r.playbook?.title === "Requested Solution" &&
      r.template?.title === "Scope of Work",
  ),
  "requested solution maps to scope",
);
assert(
  aligned.rows.some(
    (r) =>
      r.playbook?.title === "Overview" && r.template?.title === "Introduction",
  ),
  "overview maps to introduction",
);

const numbered = alignPlaybookToTemplate(
  parsePlaybookSections([
    { key: "cover", title: "Commercial Proposal" },
    { key: "overview", title: "Overview" },
  ]),
  [
    { key: "introduction", title: "1. Introduction" },
    { key: "support", title: "7. Support" },
  ],
);
assert(numbered.rows[0]?.playbook?.title === "Commercial Proposal", "cover stays first");
assert(numbered.rows[0]?.kind === "playbook_only", "cover is new");
assert(
  numbered.rows[1]?.playbook?.title === "Overview" &&
    numbered.rows[1]?.template?.title === "1. Introduction",
  "overview aligns to numbered introduction",
);
assert(
  numbered.rows[2]?.kind === "template_only" &&
    numbered.rows[2]?.template?.title === "7. Support",
  "unused template section follows the match instead of jumping to the top",
);

const meta = parsePlaybookMeta({
  tags: ["ITSM"],
  pricingShape: "line_items",
  overallTone: "formal",
});
assert(meta.tags[0] === "ITSM", "tags");
assert(meta.pricingShape === "line_items", "pricing shape");

assert(snippetPlain("<p>Hello world</p>") === "Hello world", "strips tags");

console.log("proposal-playbook-align tests ok");
