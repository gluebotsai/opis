/**
 * Lightweight unit checks (run: npx tsx src/service/sales/stages.test.ts)
 */
import { normalizeDealStage } from "./stages";

function assert(cond: unknown, msg: string) {
  if (!cond) throw new Error(msg);
}

assert(normalizeDealStage("proposal") === "propose", "proposal → propose");
assert(normalizeDealStage("Propose") === "propose", "Propose → propose");
assert(normalizeDealStage("qualified") === "qualification", "qualified");
assert(normalizeDealStage("closed won") === "closed_won", "closed won");
assert(normalizeDealStage("nope") === null, "unknown");

console.log("stages.test.ts ok");
