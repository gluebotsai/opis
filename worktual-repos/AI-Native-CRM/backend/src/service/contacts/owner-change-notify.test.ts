import assert from "node:assert/strict";
import { shouldNotifyCustomerOfOwnerChange } from "./owner-change-notify";

assert.equal(
  shouldNotifyCustomerOfOwnerChange({
    previousOwnerUserId: "1000",
    newOwnerUserId: "1001",
  }),
  true,
  "different owners should notify",
);

assert.equal(
  shouldNotifyCustomerOfOwnerChange({
    previousOwnerUserId: "1000",
    newOwnerUserId: "1000",
  }),
  false,
  "same owner should not notify",
);

assert.equal(
  shouldNotifyCustomerOfOwnerChange({
    previousOwnerUserId: null,
    newOwnerUserId: "1001",
  }),
  false,
  "first assignment should not notify",
);

assert.equal(
  shouldNotifyCustomerOfOwnerChange({
    previousOwnerUserId: "1000",
    newOwnerUserId: null,
  }),
  false,
  "unassign should not notify customer",
);

console.log("owner-change-notify.test.ts passed");
