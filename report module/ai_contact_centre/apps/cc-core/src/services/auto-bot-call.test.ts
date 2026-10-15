import assert from "node:assert/strict";
import test from "node:test";

import { buildAutoBotCallMessage, campaignAcdChannel } from "./auto-bot-call.js";

test("auto bot call message uses the campaign fields", () => {
  const message = buildAutoBotCallMessage({
    organizationId: "1012",
    domainName: "1012.call.worktual.com",
    sessionId: "6f1c0c3e-1b2a-4d5e-9a70-0c1d2e3f4a5b",
    customerNumber: "919952282829",
    cli: "917200462856",
    data: { customer_name: "Subaz Bharathi", phone: "919150911820" },
    instruction: "Greet the customer and confirm the recent order.",
  });
  assert.deepEqual(message, {
    domainId: "1012",
    domainName: "1012.call.worktual.com",
    session_id: "6f1c0c3e-1b2a-4d5e-9a70-0c1d2e3f4a5b",
    req_type: "AUTO_BOT_CALL",
    ddi: "919952282829",
    cli: "917200462856",
    data: { customer_name: "Subaz Bharathi", phone: "919150911820" },
    instruction: "Greet the customer and confirm the recent order.",
  });
});

test("campaign channel defaults to the QA campaign channel", () => {
  const previous = process.env.CAMPAIGN_ACD_CHANNEL;
  delete process.env.CAMPAIGN_ACD_CHANNEL;
  assert.equal(campaignAcdChannel(), "CAMPAIGN_ACD_QA_70");
  process.env.CAMPAIGN_ACD_CHANNEL = "CAMPAIGN_ACD_QA_71";
  assert.equal(campaignAcdChannel(), "CAMPAIGN_ACD_QA_71");
  if (previous === undefined) delete process.env.CAMPAIGN_ACD_CHANNEL;
  else process.env.CAMPAIGN_ACD_CHANNEL = previous;
});
