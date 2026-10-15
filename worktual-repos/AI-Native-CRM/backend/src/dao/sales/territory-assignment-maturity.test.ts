/**
 * Lightweight unit checks (run: npx tsx src/dao/sales/territory-assignment-maturity.test.ts)
 */
import {
  maturityWinRateWeight,
  repMaturityFromClosedWon,
} from "./territory-assignment";

function assert(cond: unknown, msg: string) {
  if (!cond) throw new Error(msg);
}

assert(repMaturityFromClosedWon(0) === "new", "0 closed → new");
assert(repMaturityFromClosedWon(19) === "new", "19 closed → new");
assert(repMaturityFromClosedWon(20) === "ramping", "20 closed → ramping");
assert(repMaturityFromClosedWon(49) === "ramping", "49 closed → ramping");
assert(repMaturityFromClosedWon(50) === "established", "50 closed → established");

assert(maturityWinRateWeight("new") === 0, "new weight");
assert(maturityWinRateWeight("ramping") === 0.3, "ramping weight");
assert(maturityWinRateWeight("established") === 1, "established weight");

console.log("territory-assignment-maturity.test.ts: ok");
