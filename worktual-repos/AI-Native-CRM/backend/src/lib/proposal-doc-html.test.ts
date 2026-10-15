/**
 * run: npx tsx src/lib/proposal-doc-html.test.ts
 */
import {
  mergeProposalDocHtml,
  sectionsFromProposalDocHtml,
  applySectionToProposalDocHtml,
  mergeVisibleSectionBodies,
} from "./proposal-doc-html";

function assert(cond: unknown, msg: string) {
  if (!cond) throw new Error(msg);
}

const stored =
  '<style>.proposal-doc{color:#111}</style>' +
  '<article class="proposal-doc">' +
  '<section class="sec" data-slot="overview"><h1 class="sec-h">Overview</h1><p>Old</p></section>' +
  "</article>";

const edited =
  '<article class="proposal-doc">' +
  '<section class="sec" data-slot="overview"><h1 class="sec-h">Overview</h1><p>New copy</p></section>' +
  "</article>";

const merged = mergeProposalDocHtml(stored, edited);
assert(merged.includes("New copy"), "replaces proposal-doc body");
assert(merged.includes("<style>"), "keeps frozen CSS");
assert(!merged.includes("Old"), "drops previous section copy");

const sections = sectionsFromProposalDocHtml(merged, [
  {
    id: "sec-overview",
    key: "overview",
    title: "Overview",
    body: "Old",
    sortOrder: 1,
  },
]);
assert(sections[0]?.id === "sec-overview", "keeps existing section id");
assert(sections[0]?.body.includes("New copy"), "syncs section body from HTML");

const rewritten = applySectionToProposalDocHtml(stored, {
  key: "overview",
  title: "Overview",
  body: "Telecom contact centre for Fincity.",
});
assert(rewritten.includes("Telecom contact centre for Fincity."), "rewrites section body in HTML");
assert(rewritten.includes("Overview"), "keeps heading");
assert(!rewritten.includes("<p>Old</p>"), "drops previous body");

const visibleMerged = mergeVisibleSectionBodies(
  [
    {
      id: "sec-rs",
      key: "requested_solution",
      title: "Requested Solution",
      body: "stale json body",
      sortOrder: 2,
    },
  ],
  [
    {
      id: "sec-rs",
      key: "requested_solution",
      title: "Requested Solution",
      body: "Keep this Worktual CCaaS copy.",
      sortOrder: 2,
    },
  ],
);
assert(
  visibleMerged[0]?.body.includes("Keep this Worktual CCaaS copy."),
  "rewrite uses on-page HTML body not stale JSON",
);

console.log("proposal-doc-html.test.ts ok");
