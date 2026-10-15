/**
 * Run: npx tsx src/lib/agents-join.selftest.ts
 */
import {
  canJoinCreateCampaignSocketSession,
  claimCreateCampaignSocketSession,
  claimedCreateCampaignSocketSession,
  isAgentsUnableToConnectError,
  releaseCreateCampaignSocketSession,
  resetCreateCampaignSocketSessionClaimForTests,
} from "./agents-join";

resetCreateCampaignSocketSessionClaimForTests();

if (claimedCreateCampaignSocketSession() !== null) {
  throw new Error("claim starts empty");
}
if (!canJoinCreateCampaignSocketSession("hub-1")) {
  throw new Error("unclaimed socket should allow hub join");
}

claimCreateCampaignSocketSession("draft-uuid");
if (claimedCreateCampaignSocketSession() !== "draft-uuid") {
  throw new Error("draft claim not stored");
}
if (canJoinCreateCampaignSocketSession("hub-1")) {
  throw new Error("hub must not join after draft claimed the socket");
}
if (!canJoinCreateCampaignSocketSession("draft-uuid")) {
  throw new Error("draft must still be able to join its own claim");
}

claimCreateCampaignSocketSession("draft-uuid");
releaseCreateCampaignSocketSession("hub-1");
if (claimedCreateCampaignSocketSession() !== "draft-uuid") {
  throw new Error("releasing a different session must not drop the draft claim");
}

releaseCreateCampaignSocketSession("draft-uuid");
if (claimedCreateCampaignSocketSession() !== null) {
  throw new Error("draft release should clear claim");
}
if (!canJoinCreateCampaignSocketSession("hub-2")) {
  throw new Error("hub may join after draft released the socket");
}

if (!isAgentsUnableToConnectError('44"Unable to connect"')) {
  throw new Error("packet 44 text should match");
}
if (!isAgentsUnableToConnectError(new Error("Unable to connect"))) {
  throw new Error("Error.message should match");
}
if (!isAgentsUnableToConnectError({ message: "Unable to connect" })) {
  throw new Error("payload.message should match");
}
if (isAgentsUnableToConnectError("session join failed")) {
  throw new Error("unrelated errors must not match");
}

resetCreateCampaignSocketSessionClaimForTests();
console.log("agents-join.selftest: ok");
