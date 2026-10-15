/**
 * run: npx tsx src/service/contacts/customer-360-ai-present.test.ts
 */
import assert from "node:assert/strict";
import {
  filterDuplicateRecommendations,
  sanitizeCustomer360Insight,
  sanitizeCustomer360Recommendation,
} from "./customer-360-ai-present";

const debug = sanitizeCustomer360Insight({
  type: "future_value",
  score: 1,
  summary: "Predicted LTV 1.0 None",
  explanation:
    "Model returned predicted_ltv=1.0 currency=None confidence=0.5.",
});
assert.equal(debug.summary, "Predicted LTV 1.0 (estimated)");
assert.equal(debug.explanation, null);

const affinity = sanitizeCustomer360Insight({
  type: "product_affinity",
  score: 0.4,
  summary: "Top affinity scheduled_score_backfill (0.4)",
  explanation:
    "Model returned affinities={'scheduled_score_backfill': 0.4} top=scheduled_score_backfill.",
});
assert.match(affinity.summary ?? "", /recent engagement/i);
assert.equal(affinity.explanation, null);

assert.equal(
  sanitizeCustomer360Recommendation({
    type: "next_purchase_timing",
    text: "Next purchase expected in ~21.0 days",
  }),
  "Next purchase expected in ~21.0 days",
);

const recs = filterDuplicateRecommendations(
  [{ type: "product_affinity" }, { type: "future_value" }],
  [{ type: "product_affinity" }, { type: "next_purchase_timing" }],
);
assert.deepEqual(recs.map((r) => r.type), ["next_purchase_timing"]);

console.log("customer-360-ai-present.test.ts ok");
