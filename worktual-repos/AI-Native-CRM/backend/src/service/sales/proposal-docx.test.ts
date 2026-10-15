/**
 * run: npx tsx src/service/sales/proposal-docx.test.ts
 */
import { spawnSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import { htmlToDocxChildren, proposalHtmlToDocxBuffer } from "./proposal-docx";
import { Table } from "docx";

function assert(cond: unknown, msg: string) {
  if (!cond) throw new Error(msg);
}

const previewHtml = `
<style>
.proposal-doc {
  --c-primary: #073763;
  --c-text: #1a1a1a;
  --size-title: 14pt;
  --size-h1: 11pt;
  --size-body: 11pt;
  --size-brand: 24pt;
  padding: 48pt 48pt 48pt 48pt;
}
.proposal-doc table.bp-table{display:table}
.proposal-doc .product-tags{text-align:center;list-style:none}
</style>
<article class="proposal-doc">
  <div class="cover-block bp-playbook-cover">
    <p class="cover-brand">ZIFO</p>
    <h1 class="cover-title bp-cover-title">Commercial Proposal</h1>
    <p class="cover-prepared">Prepared for MICE Global</p>
    <p class="cover-date">11 Sep 2026</p>
  </div>
  <ul class="product-tags layout-centered_wrap">
    <li>Intelligent CRM with AI-Native Ticketing</li>
  </ul>
  <section class="sec" data-slot="scope">
    <h1 class="sec-h bp-h2">Product Portfolio Overview</h1>
    <div class="blk" data-kind="table">
      <table class="bp-table">
        <thead><tr><th>Item</th><th>Requested</th><th>Recommended</th></tr></thead>
        <tbody>
          <tr><td>Conference kits</td><td>500</td><td>750</td></tr>
          <tr><td>Badges</td><td>500</td><td>750</td></tr>
        </tbody>
      </table>
    </div>
  </section>
</article>
`;

const children = htmlToDocxChildren(previewHtml);
const tables = children.filter((child) => child instanceof Table);
assert(tables.length === 1, "keeps HTML tables as Word tables");
assert(children.length >= 4, "keeps cover plus section heading");

const buffer = await proposalHtmlToDocxBuffer({
  number: "PROP-0024",
  title: "Commercial Proposal",
  customerName: "MICE Global",
  vendorName: "ZIFO",
  date: "11 Sep 2026",
  html: previewHtml,
});
assert(buffer.length > 2000, "writes a docx buffer");
assert(buffer.subarray(0, 2).toString() === "PK", "docx is a zip");
writeFileSync("/tmp/proposal-docx-test.docx", buffer);
const xml =
  spawnSync(
    "python3",
    [
      "-c",
      "import zipfile,sys; print(zipfile.ZipFile(sys.argv[1]).read('word/document.xml').decode())",
      "/tmp/proposal-docx-test.docx",
    ],
    { encoding: "utf8" },
  ).stdout || "";
assert(xml.includes("word") || xml.includes("w:document"), "document.xml readable");
assert(
  !xml.includes('w:pStyle w:val="Heading1"'),
  "does not apply Word Heading 1 to the title",
);
assert(
  /w:pgMar[^>]*w:left="960"/.test(xml),
  "page margins match 48pt preview inset",
);
assert(
  xml.includes("Intelligent CRM with AI-Native Ticketing"),
  "keeps product tags as text",
);

console.log("proposal-docx.test.ts ok");
