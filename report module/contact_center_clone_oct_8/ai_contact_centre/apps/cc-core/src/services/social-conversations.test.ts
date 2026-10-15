import assert from "node:assert/strict";
import test from "node:test";

import {
  ingestInboundSocialSchema,
  SOCIAL_EXTERNAL_MESSAGE_ID_MAX,
  buildSocialSessionExternalThreadId,
} from "./social-conversations.js";

const base = {
  organizationId: "ce4ff326-4c0e-43f2-a978-e6b494cd0775",
  channelConfigId: "7657a844-d2a8-41bd-9e29-205bc7ba40bc",
  channelType: "instagram" as const,
  externalThreadId: "4165014927129795",
  customerRef: "4165014927129795",
  body: "Hi",
  occurredAt: "2026-08-05T12:00:00.000Z",
};

const metaInstagramMid =
  "aWdfZAG1faXRlbToxOklHTWVzc2FnZAUlEOjE3ODQxNDQwNjg4NTg2NzUyOjM0MDI4MjM2Njg0MTcxMDMwMTI0NDI1OTIwNjg5NjYwNjU3MzE3MTozMjk0NDYzNDIwMjg0NTIzNjUyMjY5OTk4NjMwMjkyNjg0OAZDZD";

test("buildSocialSessionExternalThreadId creates unique session keys per channel", () => {
  const whatsapp = buildSocialSessionExternalThreadId("whatsapp");
  const instagram = buildSocialSessionExternalThreadId("instagram");
  assert.match(whatsapp, /^whatsapp:[0-9a-f-]{36}$/);
  assert.match(instagram, /^instagram:[0-9a-f-]{36}$/);
  assert.notEqual(whatsapp, buildSocialSessionExternalThreadId("whatsapp"));
});

test("ingestInboundSocialSchema accepts Meta Instagram mids longer than 128 characters", () => {
  assert.ok(metaInstagramMid.length > 128);
  assert.ok(metaInstagramMid.length <= SOCIAL_EXTERNAL_MESSAGE_ID_MAX);

  const parsed = ingestInboundSocialSchema.safeParse({
    ...base,
    externalMessageId: metaInstagramMid,
  });
  assert.equal(parsed.success, true);
});

test("ingestInboundSocialSchema rejects external message ids above the configured max", () => {
  const parsed = ingestInboundSocialSchema.safeParse({
    ...base,
    externalMessageId: "x".repeat(SOCIAL_EXTERNAL_MESSAGE_ID_MAX + 1),
  });
  assert.equal(parsed.success, false);
});
