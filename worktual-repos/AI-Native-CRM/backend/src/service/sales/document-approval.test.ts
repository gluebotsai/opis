/**
 * Document approval gate checks (run: npx tsx src/service/sales/document-approval.test.ts)
 */
import {
  assertDocumentApprovedForSend,
  DocumentApprovalRequiredError,
} from "./document-approval";

function assert(cond: unknown, msg: string) {
  if (!cond) throw new Error(msg);
}

let threw = false;
try {
  assertDocumentApprovedForSend({}, "quote");
} catch (err) {
  threw = err instanceof DocumentApprovalRequiredError;
}
assert(threw, "unapproved quote must throw");

threw = false;
try {
  assertDocumentApprovedForSend(
    { approvedByUserId: "u1", approvedAt: null },
    "proposal",
  );
} catch (err) {
  threw = err instanceof DocumentApprovalRequiredError;
}
assert(threw, "missing approvedAt must throw");

assertDocumentApprovedForSend(
  { approvedByUserId: "u1", approvedAt: new Date() },
  "invoice",
);

console.log("document-approval.test.ts: ok");
