/**
 * run: npx tsx --tsconfig tsconfig.json src/dao/finance/invoice-from-order.test.ts
 */
import { invoiceCreateStatusFromOrderOptions } from "./invoice-service";

function assert(cond: unknown, msg: string) {
  if (!cond) throw new Error(msg);
}

const draft = invoiceCreateStatusFromOrderOptions({
  mode: "draft_pending_finance",
});
assert(draft.status === "draft", "quote-accept invoice is draft");
assert(
  draft.approvalStatus === "pending_approval",
  "quote-accept invoice pending finance",
);

const commerce = invoiceCreateStatusFromOrderOptions({ mode: "default" });
assert(commerce.status === "draft", "commerce invoice is draft until sent");
assert(commerce.approvalStatus === "drafting", "commerce approval drafting");

console.log("invoice-from-order status ok");
