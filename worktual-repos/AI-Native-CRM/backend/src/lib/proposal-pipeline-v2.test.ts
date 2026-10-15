/**
 * run: npx tsx src/lib/proposal-pipeline-v2.test.ts
 */
import {
  hashProposalGenerateInput,
  isProposalPipelineV2Enabled,
  proposalOutlineMode,
} from "./proposal-pipeline-v2";

function assert(cond: unknown, msg: string) {
  if (!cond) throw new Error(msg);
}

const prev = { ...process.env };
process.env.PROPOSAL_PIPELINE_V2 = "";
process.env.PROPOSAL_PIPELINE_V2_ORGS = "";
process.env.PROPOSAL_PIPELINE_V2_KILL = "";
assert(!isProposalPipelineV2Enabled("1000"), "default off");

process.env.PROPOSAL_PIPELINE_V2_ORGS = "1000";
assert(isProposalPipelineV2Enabled("1000"), "org allowlist");
assert(!isProposalPipelineV2Enabled("2000"), "other org off");

process.env.PROPOSAL_PIPELINE_V2_KILL = "1";
assert(!isProposalPipelineV2Enabled("1000"), "kill switch");
process.env.PROPOSAL_PIPELINE_V2_KILL = "";

process.env.PROPOSAL_OUTLINE_MODE = "";
assert(proposalOutlineMode() === "frozen", "outline frozen by default");

const a = hashProposalGenerateInput({ dealId: "d1", requirementText: "hello" });
const b = hashProposalGenerateInput({ dealId: "d1", requirementText: "hello" });
const c = hashProposalGenerateInput({ dealId: "d2", requirementText: "hello" });
assert(a === b && a !== c, "hash includes deal");

Object.assign(process.env, prev);
console.log("proposal-pipeline-v2 tests ok");
