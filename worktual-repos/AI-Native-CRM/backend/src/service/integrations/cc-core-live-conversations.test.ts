import assert from "node:assert/strict";
import { lookupLiveConversations } from "./cc-core-live-conversations";

const originalFetch = globalThis.fetch;
const originalKey = process.env.CC_CORE_INTERNAL_SERVICE_KEY;
const originalBase = process.env.CC_CORE_API_BASE_URL;

try {
  process.env.CC_CORE_INTERNAL_SERVICE_KEY = "test-key";
  process.env.CC_CORE_API_BASE_URL = "https://cc-core.example.test";

  const request: { url: string; init?: RequestInit } = { url: "" };
  globalThis.fetch = async (url, init) => {
    request.url = String(url);
    request.init = init;
    return new Response(
      JSON.stringify({
        contactId: "cdp_1003_suji",
        matchedAs: "cdp_id",
        live: true,
        channels: ["whatsapp"],
        conversations: [
          {
            conversationId: "104821",
            channel: "whatsapp",
            status: "active",
            with: "agent",
            assignedUserId: "5012",
            startedAt: "2026-10-08T08:15:00.000Z",
            updatedAt: "2026-10-08T08:22:10.000Z",
          },
        ],
      }),
      { status: 200, headers: { "Content-Type": "application/json" } },
    );
  };

  const open = await lookupLiveConversations({
    organizationId: "1003",
    identifier: "cdp_1003_suji",
  });
  assert.equal(open.ok, true);
  assert.equal(open.ok && open.live, true);
  assert.deepEqual(open.ok && open.channels, ["whatsapp"]);
  assert.equal(
    request.url,
    "https://cc-core.example.test/internal/v1/contacts/live-conversations",
  );
  assert.equal(
    (request.init?.headers as Record<string, string>)["x-internal-service-key"],
    "test-key",
  );
  assert.deepEqual(JSON.parse(String(request.init?.body)), {
    organizationId: "1003",
    identifier: "cdp_1003_suji",
  });

  globalThis.fetch = async () =>
    new Response(
      JSON.stringify({
        contactId: null,
        matchedAs: null,
        live: false,
        channels: [],
        conversations: [],
      }),
      { status: 200 },
    );
  const closed = await lookupLiveConversations({
    organizationId: "1003",
    identifier: "unknown",
  });
  assert.deepEqual(closed, {
    ok: false,
    error: "cc_core_live_lookup_identity_not_matched",
    status: 200,
  });

  globalThis.fetch = async () =>
    new Response(
      JSON.stringify({
        live: false,
        channels: ["webchat"],
        conversations: [
          {
            conversationId: "1",
            channel: "webchat",
            status: "active",
            with: "agent",
            assignedUserId: null,
            startedAt: "2026-10-08T08:15:00.000Z",
            updatedAt: "2026-10-08T08:22:10.000Z",
          },
        ],
      }),
      { status: 200 },
    );
  const inconsistent = await lookupLiveConversations({
    organizationId: "1003",
    identifier: "cdp_1003_suji",
  });
  assert.deepEqual(inconsistent, {
    ok: false,
    error: "cc_core_live_lookup_invalid_response",
    status: 200,
  });

  globalThis.fetch = async () =>
    new Response(JSON.stringify({ message: "Unauthorized" }), { status: 401 });
  const unauthorized = await lookupLiveConversations({
    organizationId: "1003",
    identifier: "cdp_1003_suji",
  });
  assert.deepEqual(unauthorized, {
    ok: false,
    error: "Unauthorized",
    status: 401,
  });
} finally {
  globalThis.fetch = originalFetch;
  if (originalKey == null) delete process.env.CC_CORE_INTERNAL_SERVICE_KEY;
  else process.env.CC_CORE_INTERNAL_SERVICE_KEY = originalKey;
  if (originalBase == null) delete process.env.CC_CORE_API_BASE_URL;
  else process.env.CC_CORE_API_BASE_URL = originalBase;
}

console.log("cc-core-live-conversations.test.ts ok");
