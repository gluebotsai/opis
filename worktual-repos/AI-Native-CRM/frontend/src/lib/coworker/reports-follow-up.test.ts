/**
 * Lightweight unit checks (run: npx tsx src/lib/coworker/reports-follow-up.test.ts)
 */
import { reportsCardFollowUp, splitTrailingQuestion } from "./reports-follow-up";

function assert(cond: unknown, msg: string) {
  if (!cond) throw new Error(msg);
}

const answer = [
  "<p><strong>Your 7 open deals</strong></p>",
  "<p>You have 7 open deals.</p>",
  "<p>Want me to flag which of these have no expected close date?</p>",
].join("");

const moved = splitTrailingQuestion(answer);
assert(
  moved.followUp ===
    "<p>Want me to flag which of these have no expected close date?</p>",
  "trailing question paragraph is lifted whole",
);
assert(
  moved.body.startsWith("<p><strong>Your 7 open deals</strong></p>"),
  "answer body stays above the question",
);
assert(!moved.body.includes("Want me to flag"), "question leaves the body");

const wrapped = splitTrailingQuestion(
  "<p>Seven open deals.</p><p>Want me to flag which of these<br>have no expected close date?</p>",
);
assert(
  wrapped.followUp.includes("<br>"),
  "a two-line question stays one paragraph",
);
assert(wrapped.body === "<p>Seven open deals.</p>", "body stops before the question");

const statement = splitTrailingQuestion(
  "<p>You have 7 open deals.</p><p>The pricing deal is included.</p>",
);
assert(statement.followUp === "", "a trailing statement stays in the answer");
assert(statement.body.includes("The pricing deal is included."), "statement is not moved");

const listAfter = splitTrailingQuestion(
  "<p>Want the owners?</p><ul><li>Raghuram</li></ul>",
);
assert(listAfter.followUp === "", "a paragraph with content after it stays put");

const reports = { audit: { source: "reports_b2b" }, plan: { source: "reports_b2b" } };
const withCard = reportsCardFollowUp(answer, reports, true);
assert(withCard.followUp.includes("?"), "reports card moves the question");

const noCard = reportsCardFollowUp(answer, reports, false);
assert(noCard.followUp === "", "reports text without a card stays one block");
assert(noCard.body.includes("Want me to flag"), "question remains in the answer");

const ontology = reportsCardFollowUp(
  answer,
  { audit: { source: "ontology_layer" }, plan: { source: "ontology_layer" } },
  true,
);
assert(ontology.followUp === "", "a non-reports reply is not split");
assert(ontology.body.includes("Want me to flag"), "non-reports text is unchanged");

const kg = reportsCardFollowUp(
  answer,
  { audit: { source: "reports_b2b_kg" } },
  true,
);
assert(kg.followUp.includes("?"), "knowledge-graph reports replies use the same split");

console.log("reports-follow-up.test.ts ok");
