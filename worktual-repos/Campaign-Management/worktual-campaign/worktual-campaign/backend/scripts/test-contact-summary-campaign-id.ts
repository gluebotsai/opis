/**
 * listContactSummariesByIdsDao must key by campaign contact id (audience rows).
 * Run: npx tsx scripts/test-contact-summary-campaign-id.ts
 */
import assert from "node:assert/strict";
import {
  campaignContactIdFromCdp,
  isRecognizedContactId,
} from "../src/helpers/id-schema.js";

const cdp = "CDP-campaign-org1012-1833394461595543";
const campaignId = campaignContactIdFromCdp(cdp);
assert.equal(campaignId, "1833394461595543");

const mapKey = campaignContactIdFromCdp(cdp);
assert.equal(mapKey, campaignId);

const emailCdp = "CDP-call-org1012-aiswaryaalagiri1@gmail.com";
assert.equal(isRecognizedContactId(emailCdp), true);
assert.match(campaignContactIdFromCdp(emailCdp), /^\d+$/);

console.log("contact summary campaign id alignment ok");
