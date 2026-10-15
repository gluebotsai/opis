import assert from "node:assert/strict";
import test from "node:test";

import { setRedisClient } from "../lib/redis-client.js";
import {
  getSipCredentialSession,
  listOutboundCallerOptions,
  registerSipOnLogin,
  selectOutboundCallerId,
  sipRegistrationKey,
  sipRegistrationPayload,
  sipRegistrarUriFor,
  sipUriFor,
  unregisterSipOnLogout,
} from "./sip-registration.js";

type Stored = { set: Map<string, string>; deleted: string[] };

function mockRedis(): Stored {
  const stored: Stored = { set: new Map(), deleted: [] };
  setRedisClient({
    set: async (key: string, value: string) => {
      stored.set.set(key, value);
      return "OK";
    },
    del: async (...keys: string[]) => {
      for (const key of keys) {
        stored.deleted.push(key);
        stored.set.delete(key);
      }
      return keys.length;
    },
    exists: async (key: string) => (stored.set.has(key) ? 1 : 0),
    get: async (key: string) => stored.set.get(key) ?? null,
  } as never);
  return stored;
}

function mockPrisma(
  row: {
    ext: number | null;
    sip_login_id: string | null;
    sip_password: string | null;
    first_name?: string;
    last_name?: string;
    organization_id?: bigint;
  } | null,
  dids: Array<{
    phone_number: string;
    routing_user_id: bigint | null;
    routing_queue_id: bigint | null;
  }> = [],
  sipDomainName?: string | null,
  queueIds: bigint[] = [],
) {
  return {
    $transaction: async (fn: (tx: unknown) => Promise<unknown>) => fn({
      $executeRaw: async () => undefined,
      setup_users: {
        findFirst: async () => row,
      },
      organizations: {
        findFirst: async () => {
          if (sipDomainName === null) return { sip_domain_name: null };
          if (sipDomainName) return { sip_domain_name: sipDomainName };
          if (!row?.organization_id) return null;
          return { sip_domain_name: `${row.organization_id}.call.worktual.com` };
        },
      },
      setup_voice_dids: {
        findMany: async () => dids,
      },
      setup_ccaas_queue_agents: {
        findMany: async () => queueIds.map((queue_id) => ({ queue_id })),
      },
      setup_ccaas_queues: {
        findMany: async () => queueIds.map((id) => ({ id, name: `Queue ${id}` })),
      },
    }),
  } as never;
}

test("sipRegistrationKey uses ext@org.call.worktual.com", () => {
  assert.equal(sipRegistrationKey("200", "12657"), "200@12657.call.worktual.com");
});

test("sipUriFor matches Redis AOR host with signaling port 5060", () => {
  assert.equal(sipUriFor("200", "12657"), "sip:200@12657.call.worktual.com:5060");
});

test("sipRegistrarUriFor is domain:5060 with no user", () => {
  assert.equal(sipRegistrarUriFor("12657"), "sip:12657.call.worktual.com:5060");
});

test("sip helpers use organizations.sip_domain_name when set", () => {
  assert.equal(
    sipRegistrationKey("200", "1000", "1000.call.worktual.co.uk"),
    "200@1000.call.worktual.co.uk",
  );
  assert.equal(
    sipUriFor("200", "1000", "1000.call.worktual.co.uk"),
    "sip:200@1000.call.worktual.co.uk:5060",
  );
});

test("sipRegistrationPayload matches registrar JSON", () => {
  assert.equal(
    sipRegistrationPayload({
      ext: "200",
      organizationId: "7855",
      sipPassword: "c4b537641e2f671",
      callerName: "fivoso delaeb",
      sipLoginId: "13699",
    }),
    JSON.stringify({
      user_id: "200",
      domain_id: "7855",
      password: "c4b537641e2f671",
      callerName: "fivoso delaeb",
      sip_login_id: "13699",
    }),
  );
});

test("registerSipOnLogin SETs registrar payload", async () => {
  const stored = mockRedis();
  await registerSipOnLogin(
    mockPrisma({
      ext: 200,
      sip_login_id: "13699",
      sip_password: "c4b537641e2f671",
      first_name: "fivoso",
      last_name: "delaeb",
      organization_id: 12657n,
    }),
    "12657",
    "1",
  );
  assert.equal(stored.set.get("200@12657.call.worktual.com"), sipRegistrationPayload({
    ext: "200",
    organizationId: "12657",
    sipPassword: "c4b537641e2f671",
    callerName: "fivoso delaeb",
    sipLoginId: "13699",
  }));
  setRedisClient(null);
});

test("registerSipOnLogin skips when sip fields are missing", async () => {
  const stored = mockRedis();
  await registerSipOnLogin(
    mockPrisma({
      ext: 200,
      sip_login_id: "",
      sip_password: "x",
      organization_id: 1n,
    }),
    "1",
    "1",
  );
  assert.equal(stored.set.size, 0);
  setRedisClient(null);
});

test("unregisterSipOnLogout DELs the registrar key", async () => {
  const stored = mockRedis();
  await unregisterSipOnLogout(
    mockPrisma({
      ext: 200,
      sip_login_id: "13699",
      sip_password: "secret",
      organization_id: 12657n,
    }),
    "12657",
    "1",
  );
  assert.deepEqual(stored.deleted, ["200@12657.call.worktual.com"]);
  setRedisClient(null);
});

test("getSipCredentialSession reports redisRegistered after SET", async () => {
  const prisma = mockPrisma({
    ext: 200,
    sip_login_id: "13699",
    sip_password: "c4b537641e2f671",
    first_name: "fivoso",
    last_name: "delaeb",
    organization_id: 12657n,
  });
  const stored = mockRedis();
  await registerSipOnLogin(prisma, "12657", "1");
  const session = await getSipCredentialSession(prisma, "12657", "1");
  assert.equal(session?.redisKey, "200@12657.call.worktual.com");
  assert.equal(session?.redisRegistered, true);
  assert.equal(session?.sipUri, "sip:200@12657.call.worktual.com:5060");
  assert.equal(session?.registrarUri, "sip:12657.call.worktual.com:5060");
  assert.equal(session?.outboundCallerId, null);
  assert.equal(stored.set.size, 1);
  setRedisClient(null);
});

test("registerSipOnLogin uses sip_domain_name from the organization row", async () => {
  const stored = mockRedis();
  await registerSipOnLogin(
    mockPrisma(
      {
        ext: 200,
        sip_login_id: "13699",
        sip_password: "c4b537641e2f671",
        first_name: "fivoso",
        last_name: "delaeb",
        organization_id: 1000n,
      },
      [],
      "1000.call.worktual.co.uk",
    ),
    "1000",
    "1",
  );
  assert.equal(stored.set.has("200@1000.call.worktual.co.uk"), true);
  assert.equal(stored.set.has("200@1000.call.worktual.com"), false);
  setRedisClient(null);
});

test("selectOutboundCallerId prefers the DID routed to this user", () => {
  assert.equal(
    selectOutboundCallerId(
      [
        { phone_number: "+917897897897", routing_user_id: null, routing_queue_id: null },
        { phone_number: "+914440004407", routing_user_id: 1001n, routing_queue_id: null },
        { phone_number: "+914440004417", routing_user_id: null, routing_queue_id: 50n },
      ],
      1001n,
      [50n],
    ),
    "+914440004407",
  );
});

test("selectOutboundCallerId uses a queue DID when the agent is on that queue", () => {
  assert.equal(
    selectOutboundCallerId(
      [
        { phone_number: "+917897897897", routing_user_id: null, routing_queue_id: null },
        { phone_number: "+914440004417", routing_user_id: null, routing_queue_id: 50n },
      ],
      1001n,
      [50n],
    ),
    "+914440004417",
  );
});

test("selectOutboundCallerId rejects org DIDs the agent is not mapped to", () => {
  assert.equal(
    selectOutboundCallerId(
      [
        { phone_number: "+917897897897", routing_user_id: null, routing_queue_id: null },
        { phone_number: "+914440004407", routing_user_id: 2002n, routing_queue_id: null },
        { phone_number: "+914440004417", routing_user_id: null, routing_queue_id: 50n },
      ],
      1001n,
      [99n],
    ),
    null,
  );
});

test("listOutboundCallerOptions returns agent and queue choices", () => {
  assert.deepEqual(
    listOutboundCallerOptions({
      dids: [
        { phone_number: "+914440004407", routing_user_id: 1001n, routing_queue_id: null },
        { phone_number: "+914440004417", routing_user_id: null, routing_queue_id: 50n },
      ],
      userId: 1001n,
      queueIds: [50n],
      callerName: "Bharathi s",
      queueNames: new Map([["50", "Sales"]]),
    }),
    [
      { id: "agent", kind: "agent", phoneNumber: "+914440004407", label: "Bharathi s" },
      { id: "queue:50:+914440004417", kind: "queue", phoneNumber: "+914440004417", label: "Sales" },
    ],
  );
});

test("listOutboundCallerOptions drops a queue DID that is already the agent DID", () => {
  assert.deepEqual(
    listOutboundCallerOptions({
      dids: [
        { phone_number: "+914440004407", routing_user_id: 1001n, routing_queue_id: 50n },
        { phone_number: "+914440004417", routing_user_id: null, routing_queue_id: 50n },
      ],
      userId: 1001n,
      queueIds: [50n],
      callerName: "Bharathi s",
      queueNames: new Map([["50", "support"]]),
    }),
    [
      { id: "agent", kind: "agent", phoneNumber: "+914440004407", label: "Bharathi s" },
      { id: "queue:50:+914440004417", kind: "queue", phoneNumber: "+914440004417", label: "support" },
    ],
  );
});

test("getSipCredentialSession returns the user-routed outbound DID", async () => {
  const prisma = mockPrisma(
    {
      ext: 101,
      sip_login_id: "10001",
      sip_password: "secret",
      first_name: "Bharathi",
      last_name: "s",
      organization_id: 1000n,
    },
    [
      { phone_number: "+917897897897", routing_user_id: null, routing_queue_id: null },
      { phone_number: "+914440004407", routing_user_id: 1001n, routing_queue_id: null },
      { phone_number: "+914440004417", routing_user_id: null, routing_queue_id: 50n },
    ],
  );
  mockRedis();
  const session = await getSipCredentialSession(prisma, "1000", "1001");
  assert.equal(session?.outboundCallerId, "+914440004407");
  assert.deepEqual(session?.outboundOptions, [
    { id: "agent", kind: "agent", phoneNumber: "+914440004407", label: "Bharathi s" },
  ]);
  setRedisClient(null);
});

test("getSipCredentialSession returns a queue DID when the agent is on that queue", async () => {
  const prisma = mockPrisma(
    {
      ext: 101,
      sip_login_id: "10001",
      sip_password: "secret",
      first_name: "Bharathi",
      last_name: "s",
      organization_id: 1000n,
    },
    [
      { phone_number: "+917897897897", routing_user_id: null, routing_queue_id: null },
      { phone_number: "+914440004417", routing_user_id: null, routing_queue_id: 50n },
    ],
    undefined,
    [50n],
  );
  mockRedis();
  const session = await getSipCredentialSession(prisma, "1000", "1001");
  assert.equal(session?.outboundCallerId, "+914440004417");
  assert.deepEqual(session?.outboundOptions, [
    { id: "queue:50:+914440004417", kind: "queue", phoneNumber: "+914440004417", label: "Queue 50" },
  ]);
  setRedisClient(null);
});

test("getSipCredentialSession withholds outbound when the agent has no DID mapping", async () => {
  const prisma = mockPrisma(
    {
      ext: 101,
      sip_login_id: "10001",
      sip_password: "secret",
      first_name: "Bharathi",
      last_name: "s",
      organization_id: 1000n,
    },
    [
      { phone_number: "+917897897897", routing_user_id: null, routing_queue_id: null },
      { phone_number: "+914440004417", routing_user_id: null, routing_queue_id: 50n },
    ],
    undefined,
    [99n],
  );
  mockRedis();
  const session = await getSipCredentialSession(prisma, "1000", "1001");
  assert.equal(session?.outboundCallerId, null);
  assert.deepEqual(session?.outboundOptions, []);
  setRedisClient(null);
});

test("getSipCredentialSession restores full payload after password-only overwrite", async () => {
  const prisma = mockPrisma({
    ext: 101,
    sip_login_id: "10001",
    sip_password: "fffd10d48ed795e",
    first_name: "Agent",
    last_name: "One",
    organization_id: 1000n,
  });
  const stored = mockRedis();
  stored.set.set("101@1000.call.worktual.com", JSON.stringify({ password: "fffd10d48ed795e" }));
  const session = await getSipCredentialSession(prisma, "1000", "1");
  assert.equal(session?.redisRegistered, true);
  assert.equal(
    stored.set.get("101@1000.call.worktual.com"),
    sipRegistrationPayload({
      ext: "101",
      organizationId: "1000",
      sipPassword: "fffd10d48ed795e",
      callerName: "Agent One",
      sipLoginId: "10001",
    }),
  );
  setRedisClient(null);
});
