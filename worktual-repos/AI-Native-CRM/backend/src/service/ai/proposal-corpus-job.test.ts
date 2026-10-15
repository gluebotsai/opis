/**
 * run: npx tsx src/service/ai/proposal-corpus-job.test.ts
 */
import {
  corpusLearnAgentSequence,
  corpusItemAlreadyExtracted,
  corpusItemHasReusableIngest,
} from "./proposal-corpus-job";

function assert(cond: unknown, msg: string) {
  if (!cond) throw new Error(msg);
}

const sequence = corpusLearnAgentSequence();
assert(
  JSON.stringify(sequence) ===
    JSON.stringify([
      "proposal-corpus-ingest",
      "proposal-corpus-pair",
      "proposal-corpus-extract",
      "proposal-corpus-case-study",
      "proposal-playbook-synthesize",
      "proposal-playbook-freeze",
    ]),
  "learn job is ingest → pair → extract → case-study → synthesize → freeze",
);
assert(
  !sequence.includes("proposal-corpus-design-geometry"),
  "design-geometry is not on the learn path",
);
assert(
  sequence.includes("proposal-playbook-synthesize"),
  "synthesize is on the learn path",
);

assert(
  corpusItemHasReusableIngest({
    status: "ingested",
    extractJson: { fullText: "x".repeat(100) },
  }),
  "ingested text is reusable",
);
assert(
  !corpusItemHasReusableIngest({
    status: "failed",
    extractJson: { fullText: "x".repeat(100) },
  }),
  "failed items are not reusable",
);
assert(
  corpusItemAlreadyExtracted({
    kind: "requirement",
    extractJson: { brd: { project_title: "GoNutriline" } },
  }),
  "requirement with brd is already extracted",
);
assert(
  !corpusItemAlreadyExtracted({
    kind: "requirement",
    extractJson: { fullText: "ingested only" },
  }),
  "requirement without brd still needs extract",
);
assert(
  corpusItemAlreadyExtracted({
    kind: "proposal",
    extractJson: { instance: { cover: {}, sections: [] } },
  }),
  "proposal with instance is already extracted",
);

console.log("proposal-corpus-job.test.ts ok");
