import assert from "node:assert/strict";
import {
  buildAutoBotCallPayload,
  isInitialVoiceNurtureEligible,
  isVoiceCallDueNow,
  lowScoreOverridesModelWait,
  nurtureReachableForSend,
  voiceBotDataFromCustomFields,
} from "./nurture-send-touch.ts";

const baseCtx = {
  organizationId: "1012",
  contactId: "CDP-shopify-org1012-26823714406731",
  displayName: "Subaz Bharathi",
  firstName: "Subaz",
  lastName: "Bharathi",
  email: "subazkumar4@gmail.com",
  secondaryEmails: [],
  phone: "919150911820",
  secondaryPhones: [],
  companyName: null,
  ownerUserId: null,
  hasCrmBotMailbox: true,
  city: "St. Thomas Mount Cantonment",
  region: "TN",
  country: "IN",
  leadSource: "shopify",
  voiceBotData: {
    preferred_channel: "whatsapp",
    lifecycle_event: "order_paid",
    payment_reference: "NTJKTGD6Y",
    product: {
      title: "PLAIN SUIT TROUSERS",
      sku: "AVE-C3A09B144EBF-11-12Y",
    },
  },
  activitiesForIntent: [],
};

const { data, instruction } = buildAutoBotCallPayload(baseCtx, {
  brief: "Post-purchase nurture: confirm fit, offer styling tips, invite reply on WhatsApp.",
  goal: "Delight after first order",
});

assert.equal(data.cdp_id, baseCtx.contactId);
assert.equal(data.last_name, "Bharathi");
assert.equal(data.region, "TN");
assert.equal(data.preferred_channel, "whatsapp");
assert.equal(data.lifecycle_event, "order_paid");
assert.equal(
  (data.product as { title: string }).title,
  "PLAIN SUIT TROUSERS",
);
assert.ok(!("nurture_brief" in data));
assert.ok(!("crm_data" in data));
assert.match(instruction, /Post-purchase nurture/);
assert.match(instruction, /Goal: Delight/);

const dedicatedInstruction =
  "This person is interested in buying the Worktual CCaaS omnichannel product. Ask which channels, agent count, and rollout timeline they need.";
const dedicatedPayload = buildAutoBotCallPayload(baseCtx, {
  brief: "Generic email brief that must not drive the call.",
  goal: "Qualify product interest",
  voiceInstruction: dedicatedInstruction,
});
assert.equal(
  dedicatedPayload.instruction,
  dedicatedInstruction,
  "LLM-authored voice instruction takes precedence over email copy",
);

const fromCf = voiceBotDataFromCustomFields({
  preferred_channel: "whatsapp",
  lifecycle_event: "order_paid",
  language: "English",
  noise: "ignored",
});
assert.equal(fromCf.preferred_channel, "whatsapp");
assert.equal(fromCf.language, "English");
assert.equal(fromCf.noise, undefined);

const voiceOn = {
  organizationId: "1012",
  nurtureCallEnabled: true,
  nurtureCallDelayMinutes: 15,
  ccCoreVoiceConfigured: true,
  updatedAt: new Date().toISOString(),
  updatedByUserId: null,
};
const voiceOff = { ...voiceOn, nurtureCallEnabled: false };

assert.equal(
  nurtureReachableForSend({
    settings: voiceOn,
    ctx: {
      ...baseCtx,
      email: "",
      phone: "8883369379",
      activitiesForIntent: [],
    },
  }),
  true,
  "voice on + phone only is reachable even without cc-core env on settings view",
);

assert.equal(
  nurtureReachableForSend({
    settings: voiceOff,
    ctx: { ...baseCtx, email: "", phone: "8883369379", activitiesForIntent: [] },
  }),
  false,
  "voice off requires email",
);

assert.equal(
  isInitialVoiceNurtureEligible({
    nurtureCallEnabled: true,
    phone: "917358510871",
    leadStatus: "new",
    contactType: "lead",
    marketingOptOut: false,
    lastSentAt: null,
    ownerUserId: null,
  }),
  true,
  "new lead with phone qualifies for first voice nurture",
);

assert.equal(
  isInitialVoiceNurtureEligible({
    nurtureCallEnabled: true,
    phone: "917358510871",
    leadStatus: "contacted",
    contactType: "lead",
    marketingOptOut: false,
    lastSentAt: null,
    ownerUserId: null,
  }),
  false,
  "non-new status does not auto-trigger first voice nurture",
);

const eligibleAt = new Date(Date.now() - 2 * 60_000).toISOString();
assert.equal(
  isVoiceCallDueNow({ callTouchEligibleAt: eligibleAt }, 1),
  true,
  "voice call due after delay elapsed",
);
assert.equal(
  isVoiceCallDueNow(
    { callTouchEligibleAt: new Date(Date.now()).toISOString() },
    5,
  ),
  false,
  "voice call not due inside delay window",
);

assert.equal(
  lowScoreOverridesModelWait({
    decision: "wait",
    rationale: "Profile is thin, wait three days.",
    lowScoreMustNurture: true,
  }),
  true,
);
assert.equal(
  lowScoreOverridesModelWait({
    decision: "wait",
    rationale: "Recent activity — wait before re-engaging.",
    lowScoreMustNurture: true,
  }),
  false,
);
assert.equal(
  lowScoreOverridesModelWait({
    decision: "wait",
    rationale: "Profile is thin.",
    lowScoreMustNurture: false,
  }),
  false,
);

console.log("nurture-send-touch.test.ts ok");
