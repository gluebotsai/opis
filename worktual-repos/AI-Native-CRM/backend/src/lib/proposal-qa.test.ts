/**
 * run: npx tsx src/lib/proposal-qa.test.ts
 */
import { runDeterministicProposalQa } from "./proposal-qa";

function assert(cond: unknown, msg: string) {
  if (!cond) throw new Error(msg);
}

const leak = runDeterministicProposalQa({
  sections: [{ key: "note", body: "Note for VBike — recycled gold." }],
  forbiddenCustomerNames: ["VBike"],
});
assert(!leak.ok, "leak fails");
assert(leak.findings.some((f) => f.code === "leakage"), "leakage code");

const placeholder = runDeterministicProposalQa({
  sections: [{ key: "overview", body: "Lorem ipsum dolor." }],
});
assert(placeholder.findings.some((f) => f.code === "placeholder"), "placeholder");

const ok = runDeterministicProposalQa({
  sections: [{ key: "overview", body: "We will deploy the AI voicebot for Acme." }],
  requirementText: "Acme needs an AI voicebot.",
});
assert(ok.ok, "clean draft passes");

console.log("proposal-qa tests ok");
