/**
 * run: npx tsx src/lib/proposal-export-layout.test.ts
 */
import {
  parseProposalExportLayout,
  ptToMm,
  ptToTwip,
} from "./proposal-export-layout";

function assert(cond: unknown, msg: string) {
  if (!cond) throw new Error(msg);
}

const html = `
<style>
.proposal-doc {
  --c-primary: #073763;
  --c-text: #1a1a1a;
  --size-title: 14pt;
  --size-h1: 11pt;
  --size-body: 11pt;
  --size-brand: 24pt;
  --c-border: #bfbfbf;
  padding: 48pt 48pt 48pt 48pt;
  font-family: Helvetica, sans-serif;
}
.proposal-doc .cover-title { color: #073763; text-align: left; }
.proposal-doc .cover-brand { color: #073763; text-align: center; }
.proposal-doc .product-tags { text-align: center; }
</style>
<article class="proposal-doc"></article>
`;

const layout = parseProposalExportLayout(html);
assert(layout.margins.top === 48, "reads 48pt top padding");
assert(layout.margins.left === 48, "reads 48pt left padding");
assert(layout.primary === "073763", "reads primary color");
assert(layout.titleColor === "073763", "reads title color");
assert(layout.coverBrandAlign === "center", "reads brand alignment");
assert(layout.coverTitleAlign === "center", "title follows the cover group, not leftover left");
assert(ptToTwip(48) === 960, "48pt is 960 twips");
assert(ptToMm(48) === "16.93mm", "48pt is ~16.93mm");

console.log("proposal-export-layout.test.ts ok");
