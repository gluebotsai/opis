import assert from "node:assert/strict";
import test from "node:test";

import {
  buildInboundCdpId,
  buildInboundCdpIdFromInput,
  cdpContactIdSchema,
  parseInboundCdpId,
  resolveInboundCdpExternalId,
  sanitizeCdpExternalId,
} from "./cdp-id.js";

test("buildInboundCdpId formats source, org, and external id", () => {
  assert.equal(
    buildInboundCdpId("webchat", "1003", "visitor_bf8da6df-630c-4394-a910-10cdeb6e7794"),
    "CDP-webchat-org1003-visitor_bf8da6df-630c-4394-a910-10cdeb6e7794",
  );
});

test("buildInboundCdpId normalizes source name", () => {
  assert.equal(
    buildInboundCdpId("Web-Chat", "1003", "visitor_1"),
    "CDP-webchat-org1003-visitor_1",
  );
});

test("buildInboundCdpIdFromInput uses channel-specific external ids", () => {
  assert.equal(
    buildInboundCdpIdFromInput("1003", {
      channel: "webchat",
      visitorId: "visitor_abc",
    }),
    "CDP-webchat-org1003-visitor_abc",
  );
  assert.equal(
    buildInboundCdpIdFromInput("1003", {
      channel: "whatsapp",
      phone: "919150911820",
    }),
    "CDP-whatsapp-org1003-919150911820",
  );
  assert.equal(
    buildInboundCdpIdFromInput("1003", {
      channel: "call",
      phone: "919492317136",
    }),
    "CDP-call-org1003-919492317136",
  );
  assert.equal(
    buildInboundCdpIdFromInput("1003", {
      channel: "email",
      email: "alice@example.com",
    }),
    "CDP-email-org1003-alice@example.com",
  );
});

test("resolveInboundCdpExternalId prefers visitor id for webchat", () => {
  assert.equal(
    resolveInboundCdpExternalId({
      channel: "webchat",
      visitorId: "visitor_abc",
      email: "alice@example.com",
    }),
    "visitor_abc",
  );
});

test("cdpContactIdSchema accepts TEXT CDP ids, not only digits", () => {
  assert.equal(
    cdpContactIdSchema.parse("CDP-whatsapp-org1003-919150911820"),
    "CDP-whatsapp-org1003-919150911820",
  );
  assert.equal(
    cdpContactIdSchema.parse("CDP-email-org1003-alice@example.com"),
    "CDP-email-org1003-alice@example.com",
  );
  assert.throws(() => cdpContactIdSchema.parse(""), /CDP contact id/);
});

test("parseInboundCdpId round-trips structured ids", () => {
  const cdpId = "CDP-webchat-org1003-visitor_bf8da6df-630c-4394-a910-10cdeb6e7794";
  assert.deepEqual(parseInboundCdpId(cdpId), {
    sourceName: "webchat",
    organizationId: "1003",
    externalId: "visitor_bf8da6df-630c-4394-a910-10cdeb6e7794",
  });
  assert.equal(parseInboundCdpId("42"), null);
});

test("sanitizeCdpExternalId hashes very long external ids", () => {
  const longValue = "x".repeat(250);
  const sanitized = sanitizeCdpExternalId(longValue);
  assert.equal(sanitized.length, 32);
  assert.match(sanitized, /^[a-f0-9]{32}$/);
});

test("resolveInboundCdpExternalId rejects channels without identity", () => {
  assert.throws(
    () => resolveInboundCdpExternalId({ channel: "webchat" }),
    /Cannot resolve external id/,
  );
});
