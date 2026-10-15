import assert from "node:assert/strict";
import test from "node:test";

import {
  DEFAULT_LONG_WAIT_SECONDS,
  DEFAULT_ROUTING_TYPE_ID,
  defaultRecordingSettings,
  defaultRoutingProfile,
  mapRecordingRow,
  mapRoutingTypeRow,
  resolveLongWaitSeconds,
  ROUTING_TYPE_LONG_WAIT,
  ROUTING_TYPE_SKILL,
  upsertOrganizationRecordingSchema,
  upsertOrganizationRoutingProfileSchema,
} from "./organization-settings.js";

const sampleTypes = [
  mapRoutingTypeRow({
    id: 1,
    code: "long_wait",
    name: "Long wait time based routing",
    description: "Wait",
    sort_order: 1,
  }),
  mapRoutingTypeRow({
    id: 3,
    code: "skill",
    name: "Skill based routing",
    description: "Skills",
    sort_order: 3,
  }),
];

test("mapRoutingTypeRow normalizes numeric ids", () => {
  assert.deepEqual(sampleTypes[0], {
    id: 1,
    code: "long_wait",
    name: "Long wait time based routing",
    description: "Wait",
    sortOrder: 1,
  });
});

test("default routing profile uses skill based routing", () => {
  const profile = defaultRoutingProfile(sampleTypes);
  assert.equal(profile.routingTypeId, DEFAULT_ROUTING_TYPE_ID);
  assert.equal(profile.routingTypeCode, "skill");
  assert.equal(profile.longWaitSeconds, null);
  assert.equal(profile.updatedAt, null);
});

test("default recording is disabled with inbound and outbound on", () => {
  assert.deepEqual(defaultRecordingSettings(), {
    recordingEnabled: false,
    inboundEnabled: true,
    outboundEnabled: true,
    consentNoticeEnabled: false,
    consentPromptId: null,
    agentAccessEnabled: false,
    updatedAt: null,
  });
});

test("resolveLongWaitSeconds only applies to long-wait routing", () => {
  assert.equal(resolveLongWaitSeconds(ROUTING_TYPE_SKILL, 90), null);
  assert.equal(resolveLongWaitSeconds(ROUTING_TYPE_LONG_WAIT, 90), 90);
  assert.equal(
    resolveLongWaitSeconds(ROUTING_TYPE_LONG_WAIT, undefined),
    DEFAULT_LONG_WAIT_SECONDS,
  );
});

test("upsert routing schema requires seconds for long wait", () => {
  assert.equal(upsertOrganizationRoutingProfileSchema.safeParse({ routingTypeId: 3 }).success, true);
  assert.equal(
    upsertOrganizationRoutingProfileSchema.safeParse({ routingTypeId: 1 }).success,
    false,
  );
  assert.equal(
    upsertOrganizationRoutingProfileSchema.safeParse({
      routingTypeId: 1,
      longWaitSeconds: 120,
    }).success,
    true,
  );
  assert.equal(
    upsertOrganizationRoutingProfileSchema.safeParse({ routingTypeId: 4 }).success,
    false,
  );
});

test("upsert recording schema accepts a boolean and fills voice defaults", () => {
  const parsed = upsertOrganizationRecordingSchema.parse({ recordingEnabled: true });
  assert.equal(parsed.recordingEnabled, true);
  assert.equal(parsed.inboundEnabled, true);
  assert.equal(parsed.outboundEnabled, true);
  assert.equal(parsed.consentNoticeEnabled, false);
  assert.equal(parsed.consentPromptId, null);
  assert.equal(parsed.agentAccessEnabled, false);
  assert.equal(upsertOrganizationRecordingSchema.safeParse({ recordingEnabled: "yes" }).success, false);
});

test("mapRecordingRow maps voice recording fields", () => {
  assert.deepEqual(
    mapRecordingRow({
      recording_enabled: true,
      inbound_enabled: true,
      outbound_enabled: false,
      consent_notice_enabled: true,
      consent_prompt_id: 44,
      agent_access_enabled: false,
      updated_at: "2026-09-14T10:00:00.000Z",
    }),
    {
      recordingEnabled: true,
      inboundEnabled: true,
      outboundEnabled: false,
      consentNoticeEnabled: true,
      consentPromptId: "44",
      agentAccessEnabled: false,
      updatedAt: "2026-09-14T10:00:00.000Z",
    },
  );
});

test("upsert recording schema requires a direction when voice is on", () => {
  assert.equal(
    upsertOrganizationRecordingSchema.safeParse({
      recordingEnabled: true,
      inboundEnabled: false,
      outboundEnabled: false,
    }).success,
    false,
  );
  assert.equal(
    upsertOrganizationRecordingSchema.safeParse({
      recordingEnabled: true,
      inboundEnabled: true,
      outboundEnabled: false,
      consentNoticeEnabled: true,
      consentPromptId: "12",
      agentAccessEnabled: true,
    }).success,
    true,
  );
});
