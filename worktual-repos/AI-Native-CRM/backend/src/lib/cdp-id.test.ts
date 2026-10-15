/**
 * run: npx tsx src/lib/cdp-id.test.ts
 */
import assert from "node:assert/strict";
import { CRM_CDP_SOURCE, formatCdpId, newCrmCdpId } from "./cdp-id.ts";

assert.equal(
  formatCdpId({
    sourceName: "CRM",
    organizationId: "1000",
    externalId: "usr_abc",
  }),
  "CDP-crm-org1000-usr_abc",
);
assert.equal(
  formatCdpId({
    sourceName: "web tracking",
    organizationId: "9",
    externalId: "user-1",
  }),
  "CDP-webtracking-org9-user-1",
);

const minted = newCrmCdpId("1000");
assert.match(minted, /^CDP-crm-org1000-[0-9a-f]{32}$/);
assert.notEqual(minted, newCrmCdpId("1000"));
assert.equal(CRM_CDP_SOURCE, "crm");

assert.throws(() =>
  formatCdpId({ sourceName: "crm", organizationId: "", externalId: "x" }),
);

console.log("cdp-id ok");
