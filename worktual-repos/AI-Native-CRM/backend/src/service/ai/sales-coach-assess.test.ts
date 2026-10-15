/**
 * run: npx tsx --tsconfig tsconfig.json src/service/ai/sales-coach-assess.test.ts
 */
import { buildRepPerformanceNotice } from "./sales-coach-assess";

function assert(cond: unknown, msg: string) {
  if (!cond) throw new Error(msg);
}

const privateNote =
  "You talked 80% of the time and skipped budget — rewrite your discovery open.";

const notice = buildRepPerformanceNotice({
  repName: "Priya S.",
  contactName: "Nandha Kumar",
  activityType: "meeting",
  overallImpression: "needs_work",
  strengths: ["Opened with a clear agenda"],
  growthAreas: ["Uncover budget earlier", "Confirm a dated next step"],
});

assert(notice.title.includes("Priya S."), "title names the rep");
assert(notice.title.includes("Needs work"), "title includes impression");
assert(notice.body.includes("Focus areas: Uncover budget earlier"), "growth areas in body");
assert(notice.body.includes("Strengths: Opened with a clear agenda"), "strengths in body");
assert(!notice.body.includes(privateNote), "private coaching note is not in leadership copy");
assert(!notice.title.toLowerCase().includes("coaching note"), "title stays summary-only");

const solid = buildRepPerformanceNotice({
  repName: null,
  contactName: null,
  activityType: "call",
  overallImpression: "solid",
  strengths: [],
  growthAreas: [],
});
assert(solid.title.includes("Sales rep"), "fallback rep label");
assert(solid.body.includes("the contact"), "fallback contact label");
assert(solid.body.includes("No specific growth areas noted."), "empty growth fallback");
assert(!solid.body.toLowerCase().includes("coachingnote"), "no coachingNote leak");

console.log("sales-coach-assess.test.ts: ok");
