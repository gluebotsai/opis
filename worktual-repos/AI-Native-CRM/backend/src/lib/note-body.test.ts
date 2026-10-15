/**
 * run: npx tsx --tsconfig tsconfig.json src/lib/note-body.test.ts
 */
import {
  parseNoteBody,
  plainTextToStructuredNoteHtml,
} from "./note-body";

function assert(cond: unknown, msg: string) {
  if (!cond) throw new Error(msg);
}

const sample = `Proposal brief (awaiting owner confirm to email)
Aiswarya A from a company currently handling customer data manually is seeking a CRM solution.

Open questions:
- How many users will need CRM access?
- Are there specific integrations required with existing systems?
- What is the expected implementation timeline?

Themes: crm`;

const html = plainTextToStructuredNoteHtml(sample);
assert(html.includes("<h3>Proposal brief</h3>"), "title heading");
assert(html.includes("<strong>Status</strong>"), "status label");
assert(html.includes("Awaiting owner confirm to email"), "status value");
assert(html.includes("<h4>Open questions</h4>"), "questions heading");
assert(html.includes("<ul>"), "bullet list");
assert(html.includes("<li>How many users will need CRM access?</li>"), "first question");
assert(html.includes("<h4>Themes</h4>"), "themes heading");
assert(html.includes("<p>crm</p>"), "theme value");
assert(!html.includes("<br>"), "no br dump");

const parsed = parseNoteBody(sample);
assert(parsed.html.includes("<h3>Proposal brief</h3>"), "parseNoteBody uses structured html");
assert(parsed.plain.toLowerCase().includes("open questions"), "plain still searchable");

const simple = plainTextToStructuredNoteHtml("Just a one-line note.");
assert(simple === "<p>Just a one-line note.</p>", "simple sentence stays a paragraph");

const sectioned = plainTextToStructuredNoteHtml(
  "Situation\nAiswarya is evaluating CRM automation.\n\nNext step\nSend the quotation.",
);
assert(sectioned.includes("<h4>Situation</h4>"), "situation heading");
assert(sectioned.includes("<h4>Next step</h4>"), "next step heading");
assert(
  plainTextToStructuredNoteHtml("Use **Worktual** CRM.").includes(
    "<strong>Worktual</strong>",
  ),
  "inline bold",
);

const keywordTable = `Keyword ideas for cloud contact center:

| Term | Intent | Volume | KD | CPC | Opportunity |
|---|---|---|---|---|---|
| cloud contact center | commercial | 4,400 | 56 | $10.80 | 54 |
| contact center pricing | commercial | 1,900 | 42 | $8.50 | 61 |

The pricing variants look like strong targets.`;

const keywordHtml = plainTextToStructuredNoteHtml(keywordTable);
assert(keywordHtml.includes('<table class="note-table">'), "markdown table tag");
assert(keywordHtml.includes("<thead>"), "table header");
assert(keywordHtml.includes("<th>Term</th>"), "header cell");
assert(keywordHtml.includes("cloud contact center"), "body cell value");
assert(!keywordHtml.includes("| Term | Intent |"), "no raw pipe row in html");

const inlineTable =
  "Top terms | Term | Intent | Volume | |---|---|---| | cloud contact center | commercial | 4,400 |";
const inlineHtml = plainTextToStructuredNoteHtml(inlineTable);
assert(inlineHtml.includes('<table class="note-table">'), "inline markdown table");
assert(inlineHtml.includes("<th>Term</th>"), "inline table header cell");
assert(inlineHtml.includes("Top terms"), "intro before inline table");
assert(!inlineHtml.includes("<th>Top terms</th>"), "prefix is not a header cell");

const collapsedChat =
  "I'm your Digital Marketing agent. Research keywords. | Term | Intent | Volume | |---|---| | cloud contact center | commercial | 4,400 | Want me to draft SEO content?";
const collapsedHtml = plainTextToStructuredNoteHtml(collapsedChat);
assert(collapsedHtml.includes('<table class="note-table">'), "collapsed chat table");
assert(collapsedHtml.includes("Digital Marketing agent"), "intro paragraph kept");
assert(collapsedHtml.includes("Want me to draft SEO content?"), "suffix paragraph kept");

console.log("note-body structured html ok");
