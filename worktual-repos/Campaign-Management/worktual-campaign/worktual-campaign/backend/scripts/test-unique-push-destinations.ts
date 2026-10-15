/**
 * Unique push destinations + FCM data payload (no duplicate title/body).
 * Run: npx tsx scripts/test-unique-push-destinations.ts
 */
import assert from "node:assert/strict";
import { uniquePushDestinations } from "../src/helpers/unique-push-destinations.js";
import { fcmDataPayload } from "../src/helpers/push-fcm-payload.js";

const sameContact = uniquePushDestinations([
  { contactId: "c1", destination: "token-a", platform: "android" },
  { contactId: "c1", destination: "token-b", platform: "android" },
]);
assert.equal(sameContact.length, 1);
assert.equal(sameContact[0]?.destination, "token-a");

const sameToken = uniquePushDestinations([
  { contactId: "c1", destination: " token-a ", platform: "android" },
  { contactId: "c2", destination: "token-a", platform: "android" },
]);
assert.equal(sameToken.length, 1);

const twoPeople = uniquePushDestinations([
  { contactId: "c1", destination: "token-a", platform: "android" },
  { contactId: "c2", destination: "token-b", platform: "ios" },
]);
assert.equal(twoPeople.length, 2);

const data = fcmDataPayload({
  cta: "Open",
  track: {
    recipient_id: "r1",
    campaign_id: "camp-1",
    channel: "push",
    click_url: "https://example.com",
  },
});
assert.equal(data.title, undefined);
assert.equal(data.body, undefined);
assert.equal(data.cta_label, "Open");
assert.equal(data.recipient_id, "r1");
assert.equal(data.campaign_id, "camp-1");
assert.equal(data.channel, "push");

console.log("unique-push-destinations + fcmDataPayload ok");
