/**
 * run: npx tsx src/service/sales/proposal-pair-score.test.ts
 */
import {
  normalizePairExtractText,
  readPairAgentConfidence,
} from "./proposal-pair-score";

function assert(cond: unknown, msg: string) {
  if (!cond) throw new Error(msg);
}

assert(
  normalizePairExtractText("Purity  Harvest   Organic  Cow") ===
    "Purity Harvest Organic Cow",
  "collapses Google Docs extra spaces",
);

const scored = readPairAgentConfidence({
  source: "ai",
  pairs: [{ confidence: 0.86, gaps: ["pricing"] }],
});
assert(scored.confidence === 0.86, "reads LLM confidence");
assert(scored.gaps[0] === "pricing", "keeps gaps");

let threw = false;
try {
  readPairAgentConfidence(null);
} catch {
  threw = true;
}
assert(threw, "null agent result is an error, not 0.00");

threw = false;
try {
  readPairAgentConfidence({ pairs: [] });
} catch {
  threw = true;
}
assert(threw, "empty pairs is an error, not 0.00");

console.log("proposal-pair-score.test.ts ok");
