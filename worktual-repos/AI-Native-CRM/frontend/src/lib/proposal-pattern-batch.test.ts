/**
 * Lightweight unit checks (run: npx tsx src/lib/proposal-pattern-batch.test.ts)
 */
import { batchFileLine, batchTitle } from "./proposal-pattern-batch";
import type { ProposalCorpusBatchSummary } from "../services/configuration";

function assert(cond: unknown, msg: string) {
  if (!cond) throw new Error(msg);
}

function batch(
  patch: Partial<ProposalCorpusBatchSummary>,
): ProposalCorpusBatchSummary {
  return {
    id: "b1",
    name: null,
    status: "completed",
    lastError: null,
    itemCount: 2,
    playbookCount: 0,
    jobStatus: "completed",
    jobId: "j1",
    createdAt: "2026-09-11T07:29:47.000Z",
    updatedAt: "2026-09-11T07:29:47.000Z",
    completedAt: "2026-09-11T07:29:47.000Z",
    ...patch,
  };
}

const filesRow = batch({
  files: [
    { id: "1", kind: "requirement", filename: "_ST courier.docx" },
    { id: "2", kind: "proposal", filename: "ST Courier win.pdf" },
  ],
});
assert(
  batchFileLine(filesRow) ===
    "Requirement: _ST courier.docx · Proposal: ST Courier win.pdf",
  "file line lists both uploads",
);
assert(batchTitle(filesRow) === "ST Courier win.pdf", "title uses proposal file");

const named = batch({
  name: "ST Courier",
  files: [{ id: "1", kind: "requirement", filename: "_ST courier.docx" }],
});
assert(batchTitle(named) === "ST Courier", "named batch keeps its title");
assert(
  batchFileLine(named).includes("_ST courier.docx"),
  "named batch still shows the file",
);

console.log("proposal-pattern-batch.test.ts ok");
