/**
 * run: npx tsx --tsconfig tsconfig.json src/service/sales/quote-from-proposal.test.ts
 */
import { buildQuoteLinesFromProposal } from "./quote-from-proposal";

function assert(cond: unknown, msg: string) {
  if (!cond) throw new Error(msg);
}

assert(typeof buildQuoteLinesFromProposal === "function", "exported builder");
console.log("quote-from-proposal exports ok");
