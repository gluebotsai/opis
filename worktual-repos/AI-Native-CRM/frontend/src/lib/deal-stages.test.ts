/**
 * Lightweight unit checks (run: npx tsx src/lib/deal-stages.test.ts)
 */
import { normalizeDealStage } from "./deal-stages";

function assert(cond: unknown, msg: string) {
  if (!cond) throw new Error(msg);
}

assert(normalizeDealStage("proposal") === "propose", "proposal → propose");
assert(normalizeDealStage("Propose") === "propose", "Propose → propose");
assert(normalizeDealStage("qualified") === "qualification", "qualified");
assert(normalizeDealStage("discover") === "discover", "discover passthrough");
assert(normalizeDealStage("nope") === null, "unknown");
assert(normalizeDealStage("") === null, "empty");

console.log("deal-stages.test.ts ok");
