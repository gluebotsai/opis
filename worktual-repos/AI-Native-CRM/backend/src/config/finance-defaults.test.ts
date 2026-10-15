/**
 * run: npx tsx --tsconfig tsconfig.json src/config/finance-defaults.test.ts
 */
import {
  billingKindBlocksCustomerSend,
  isZeroAmountTotal,
  validateOfflinePaymentReference,
} from "@/config/finance-defaults";

function assert(cond: unknown, msg: string) {
  if (!cond) throw new Error(msg);
}

assert(isZeroAmountTotal(0), "zero is zero amount");
assert(isZeroAmountTotal("0.00"), "string zero");
assert(!isZeroAmountTotal(10), "positive not zero");

assert(billingKindBlocksCustomerSend("adjustment"), "adjustment blocks send");
assert(billingKindBlocksCustomerSend("credit"), "credit blocks send");
assert(!billingKindBlocksCustomerSend("standard"), "standard allows send");

assert(
  validateOfflinePaymentReference("AB12") === null,
  "valid reference passes",
);
assert(
  validateOfflinePaymentReference("ab") === null,
  "short reference is allowed",
);

console.log("finance-defaults ok");
