import assert from "node:assert/strict";
import test from "node:test";

import { buildSipUaSession, sipSessionHttpPaths } from "./sip-session.js";

const TURN_ENV = [
  "CALL_SERVER_TURN_URL",
  "CALL_SERVER_TURN_URL_V6",
  "CALL_SERVER_TURN_USERNAME",
  "CALL_SERVER_TURN_CREDENTIAL",
] as const;

function withTurnEnv(values: Partial<Record<(typeof TURN_ENV)[number], string>>, run: () => void) {
  const previous: Record<string, string | undefined> = {};
  for (const key of TURN_ENV) {
    previous[key] = process.env[key];
    if (values[key] === undefined) delete process.env[key];
    else process.env[key] = values[key];
  }
  try {
    run();
  } finally {
    for (const key of TURN_ENV) {
      if (previous[key] === undefined) delete process.env[key];
      else process.env[key] = previous[key];
    }
  }
}

const core = {
  ext: "200",
  organizationId: "12657",
  sipLoginId: "13699",
  sipPassword: "secret",
  callerName: "fivoso delaeb",
  redisKey: "200@12657.call.worktual.com",
  redisRegistered: true,
  sipUri: "sip:200@12657.call.worktual.com:5060",
  registrarUri: "sip:12657.call.worktual.com:5060",
  realm: "12657.call.worktual.com",
};

test("buildSipUaSession uses .com URI, WSS, and legacy TURN defaults", () => {
  withTurnEnv({}, () => {
    const session = buildSipUaSession(core);
    assert.equal(session.uri, "sip:200@12657.call.worktual.com:5060");
    assert.equal(session.registrarServer, "sip:12657.call.worktual.com:5060");
    assert.equal(session.displayName, " ");
    assert.equal(session.userAgent, "CCAAS:BROWSER");
    assert.equal(session.expires, 600);
    assert.equal(session.ext, "200");
    assert.equal(session.authorizationUser, "200");
    assert.equal(session.wssUrl, "wss://nlp-audiosgw.worktual.co.uk:57344");
    assert.deepEqual(session.iceServers, [
      { urls: "stun:audioturnv4.worktual.co.uk:443" },
      { urls: "turn:audioturnv4.worktual.co.uk:443", username: "admin", credential: "system123" },
    ]);
    assert.equal(session.outboundCallerId, null);
    assert.deepEqual(session.outboundOptions, []);
  });
});

test("iceServersFromEnv attaches TURN username and credential when set", () => {
  withTurnEnv(
    {
      CALL_SERVER_TURN_URL: "turn:audioturnv4.worktual.co.uk:3478",
      CALL_SERVER_TURN_URL_V6: "turn:audioturnv6.worktual.co.uk:3478",
      CALL_SERVER_TURN_USERNAME: "turn-user",
      CALL_SERVER_TURN_CREDENTIAL: "turn-secret",
    },
    () => {
      const session = buildSipUaSession({
        ext: "101",
        organizationId: "1000",
        sipLoginId: "10001",
        sipPassword: "secret",
        callerName: "Bharathi s",
        redisKey: "101@1000.call.worktual.com",
        redisRegistered: true,
        sipUri: "sip:101@1000.call.worktual.com:5060",
        registrarUri: "sip:1000.call.worktual.com:5060",
        realm: "1000.call.worktual.com",
      });
      assert.deepEqual(session.iceServers, [
        { urls: "stun:audioturnv4.worktual.co.uk:3478" },
        {
          urls: "turn:audioturnv4.worktual.co.uk:3478",
          username: "turn-user",
          credential: "turn-secret",
        },
      ]);
    },
  );
});

test("buildSipUaSession passes outbound caller ID from cc-core", () => {
  const session = buildSipUaSession({
    ext: "101",
    organizationId: "1000",
    sipLoginId: "10001",
    sipPassword: "secret",
    callerName: "Bharathi s",
    redisKey: "101@1000.call.worktual.com",
    redisRegistered: true,
    sipUri: "sip:101@1000.call.worktual.com:5060",
    registrarUri: "sip:1000.call.worktual.com:5060",
    realm: "1000.call.worktual.com",
    outboundCallerId: "+914440004407",
    outboundOptions: [
      { id: "agent", kind: "agent", phoneNumber: "+914440004407", label: "Bharathi s" },
    ],
  });
  assert.equal(session.outboundCallerId, "+914440004407");
  assert.deepEqual(session.outboundOptions, [
    { id: "agent", kind: "agent", phoneNumber: "+914440004407", label: "Bharathi s" },
  ]);
});

test("sipSessionHttpPaths always includes internal mounts and optional public prefix", () => {
  assert.deepEqual(sipSessionHttpPaths(""), ["/api/v1/sip/session", "/v1/sip/session"]);
  assert.deepEqual(sipSessionHttpPaths("/call-api/v1"), [
    "/api/v1/sip/session",
    "/v1/sip/session",
    "/call-api/v1/sip/session",
  ]);
});
