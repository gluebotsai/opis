import assert from "node:assert/strict";
import test from "node:test";

import {
  buildUmnPresencePayload,
  inboundPresenceForUi,
  parseInboundUmnPresence,
  shouldApplyInboundUmnBusy,
  toCcaasPresenceState,
  toUmnStatusName,
  umnDomainId,
  umnForcedPresenceCode,
} from "./umn-presence.js";
import { shouldPublishPresenceToUmn } from "./presence.js";

test("UMN status names map to CCaaS presence and back", () => {
  assert.equal(toUmnStatusName("ready"), "Ready");
  assert.equal(toUmnStatusName("not_ready"), "Not Ready");
  assert.equal(toUmnStatusName("busy"), "Busy");
  assert.equal(toUmnStatusName("away"), "Away");
  assert.equal(toUmnStatusName("offline"), "Offline");
  assert.equal(toUmnStatusName("break"), "Away");
  assert.equal(toUmnStatusName("after_contact_work"), "Away");

  assert.equal(toCcaasPresenceState("Ready"), "ready");
  assert.equal(toCcaasPresenceState("Not Ready"), "not_ready");
  assert.equal(toCcaasPresenceState("Busy"), "busy");
  assert.equal(toCcaasPresenceState("Away"), "away");
  assert.equal(toCcaasPresenceState("Offline"), "offline");
  assert.equal(toCcaasPresenceState("unknown"), null);
});

test("ACD presence updates the UI only when the stored row already matches", () => {
  const current = {
    agentId: "9",
    organizationId: "1000",
    state: "busy" as const,
    reasonCode: null,
    heartbeatAt: null,
    updatedAt: "2026-09-22T00:00:00.000Z",
    version: 4,
  };
  const same = inboundPresenceForUi(current, "9", "1000", "busy");
  assert.equal(same, current);
  assert.equal(inboundPresenceForUi(current, "9", "1000", "ready"), null);
  assert.equal(inboundPresenceForUi(null, "9", "1000", "ready"), null);
});

test("local presence changes publish to UMN but inbound UMN mirrors do not echo", () => {
  assert.equal(shouldPublishPresenceToUmn("agent", "42"), true);
  assert.equal(shouldPublishPresenceToUmn("routing", "42"), true);
  assert.equal(shouldPublishPresenceToUmn("umn", "42"), false);
  assert.equal(shouldPublishPresenceToUmn("agent", null), false);
});

test("UMN Busy applies only while voice work is active", () => {
  assert.equal(shouldApplyInboundUmnBusy({ hasActiveVoiceWork: false }), false);
  assert.equal(shouldApplyInboundUmnBusy({ hasActiveVoiceWork: true }), true);
});

test("inbound UMN payload uses organization id as domainId", () => {
  const parsed = parseInboundUmnPresence(
    JSON.stringify({ domainId: "20643", statusName: "Ready", ext: "205", email: "a@b.com" }),
  );
  assert.deepEqual(parsed, {
    domainId: "20643",
    statusName: "Ready",
    ext: "205",
    email: "a@b.com",
  });
  assert.equal(umnDomainId("20556"), 20556);
});

test("outbound UMN payload uses organization id and queue flags", () => {
  const payload = buildUmnPresencePayload({
    user: {
      id: "42",
      organization_id: "20556",
      ext: 205,
      work_email: "agent@example.com",
      first_name: "Ada",
      last_name: "Lovelace",
    },
    queue: {
      id: "9",
      name: "Support",
      handles_calls: true,
      handles_inbound: true,
      handles_outbound: false,
      handles_outbound_campaign: false,
    },
    state: "ready",
  });
  assert.equal(payload.domainId, 20556);
  assert.equal(payload.ext, "205");
  assert.equal(payload.statusName, "Ready");
  assert.equal(payload.UserName, "Ada Lovelace");
  assert.equal(payload.isVoice, 1);
  assert.equal(payload.inboundCall, 1);
  assert.equal(payload.outboundCampaignCall, 0);
  assert.equal(payload.quId, "9");
  assert.equal(payload.queueName, "Support");
  assert.equal(payload.userId, "42");
  assert.equal(payload.isVoiceCallTransfer, 0);
  assert.equal(payload.forced_presence, 0);

  const busyPayload = buildUmnPresencePayload({
    user: {
      id: "42",
      organization_id: "20556",
      ext: 205,
      work_email: "agent@example.com",
      first_name: "Ada",
      last_name: "Lovelace",
    },
    queue: {
      id: "9",
      name: "Support",
      handles_calls: true,
      handles_inbound: true,
      handles_outbound: false,
      handles_outbound_campaign: false,
    },
    state: "busy",
  });
  assert.equal(busyPayload.isVoice, 0);
  assert.equal(busyPayload.isVoiceCallTransfer, 0);

  const transferPayload = buildUmnPresencePayload({
    user: {
      id: "42",
      organization_id: "20556",
      ext: 205,
      work_email: "agent@example.com",
      first_name: "Ada",
      last_name: "Lovelace",
    },
    queue: {
      id: "9",
      name: "Support",
      handles_calls: true,
      handles_inbound: true,
      handles_outbound: false,
      handles_outbound_campaign: false,
    },
    state: "busy",
    isVoiceCallTransfer: true,
  });
  assert.equal(transferPayload.isVoiceCallTransfer, 1);
});

test("forced_presence is 3 on login, 2 when Ready is restored, and 0 otherwise", () => {
  assert.equal(umnForcedPresenceCode("login", "not_ready"), 3);
  assert.equal(umnForcedPresenceCode("voice", "ready"), 2);
  assert.equal(umnForcedPresenceCode("conversation_ended", "ready"), 2);
  assert.equal(umnForcedPresenceCode("conversation_resolved", "ready"), 2);
  assert.equal(umnForcedPresenceCode("conversation_transferred", "ready"), 2);
  assert.equal(umnForcedPresenceCode("voice", "busy"), 0);
  assert.equal(umnForcedPresenceCode("toolbar", "ready"), 0);
  assert.equal(umnForcedPresenceCode("routing", "busy"), 0);
  assert.equal(umnForcedPresenceCode("agent", "not_ready"), 0);
  assert.equal(umnForcedPresenceCode("logout", "offline"), 0);
});
