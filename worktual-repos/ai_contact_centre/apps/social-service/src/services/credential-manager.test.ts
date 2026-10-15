import assert from "node:assert/strict";
import { test } from "node:test";

import { createLogger } from "@ai-contact-center/observability";

import { MetaWhatsAppError } from "../providers/meta-whatsapp.js";
import { AccountsClient } from "./accounts-client.js";
import { WhatsAppCredentialManager } from "./credential-manager.js";

const channelConfigId = "11111111-1111-4111-8111-111111111111";
const organizationId = "22222222-2222-4222-8222-222222222222";

function credentials(token: string, expiresAt: string) {
  return {
    channelConfigId,
    organizationId,
    provider: "whatsapp",
    connectionStatus: "connected",
    phoneNumberId: "123456789",
    wabaId: "987654321",
    accessToken: token,
    tokenExpiresAt: expiresAt,
  };
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

test("renews expiring credentials and deduplicates concurrent renewal", async () => {
  const now = Date.parse("2026-07-29T00:00:00.000Z");
  let renewCalls = 0;
  const fetcher: typeof fetch = async (input, init) => {
    const url = String(input);
    if (url.endsWith("/renew")) {
      renewCalls += 1;
      assert.equal(init?.method, "POST");
      await new Promise((resolve) => setTimeout(resolve, 5));
      return jsonResponse(
        credentials("renewed", "2026-09-29T00:00:00.000Z"),
      );
    }
    return jsonResponse(
      credentials("expiring", "2026-07-30T00:00:00.000Z"),
    );
  };
  const accounts = new AccountsClient(
    {
      baseUrl: "http://accounts.test",
      serviceKey: "secret",
      timeoutMs: 1_000,
      renewalWindowMs: 7 * 24 * 60 * 60 * 1_000,
      credentialCacheTtlMs: 60_000,
    },
    fetcher,
  );
  const manager = new WhatsAppCredentialManager(
    accounts,
    {
      renewalWindowMs: 7 * 24 * 60 * 60 * 1_000,
      credentialCacheTtlMs: 60_000,
    },
    createLogger({ service: "credential-manager-test" }),
    () => now,
  );

  const [first, second] = await Promise.all([
    manager.getByChannelConfigId(channelConfigId),
    manager.getByChannelConfigId(channelConfigId),
  ]);

  assert.equal(first.accessToken, "renewed");
  assert.equal(second.accessToken, "renewed");
  assert.equal(renewCalls, 1);
});

test("renews once and retries after Meta OAuth error 190", async () => {
  let renewCalls = 0;
  const fetcher: typeof fetch = async (input) => {
    if (String(input).endsWith("/renew")) {
      renewCalls += 1;
      return jsonResponse(
        credentials("renewed", "2026-09-29T00:00:00.000Z"),
      );
    }
    return jsonResponse(
      credentials("rejected", "2026-09-29T00:00:00.000Z"),
    );
  };
  const accounts = new AccountsClient(
    {
      baseUrl: "http://accounts.test",
      serviceKey: "secret",
      timeoutMs: 1_000,
      renewalWindowMs: 1_000,
      credentialCacheTtlMs: 60_000,
    },
    fetcher,
  );
  const manager = new WhatsAppCredentialManager(
    accounts,
    { renewalWindowMs: 1_000, credentialCacheTtlMs: 60_000 },
    createLogger({ service: "credential-manager-test" }),
    () => Date.parse("2026-07-29T00:00:00.000Z"),
  );
  let operationCalls = 0;

  const result = await manager.executeByChannel(
    channelConfigId,
    async (runtimeCredentials) => {
      operationCalls += 1;
      if (operationCalls === 1) {
        throw new MetaWhatsAppError("Invalid token", 401, 190);
      }
      return runtimeCredentials.accessToken;
    },
  );

  assert.equal(result, "renewed");
  assert.equal(operationCalls, 2);
  assert.equal(renewCalls, 1);
});

test("marks connection for reauthentication when renewed token is rejected", async () => {
  let markedNeedsReauth = false;
  const fetcher: typeof fetch = async (input) => {
    const url = String(input);
    if (url.endsWith("/needs-reauth")) {
      markedNeedsReauth = true;
      return jsonResponse({ updated: true });
    }
    if (url.endsWith("/renew")) {
      return jsonResponse(
        credentials("still-rejected", "2026-09-29T00:00:00.000Z"),
      );
    }
    return jsonResponse(
      credentials("rejected", "2026-09-29T00:00:00.000Z"),
    );
  };
  const accounts = new AccountsClient(
    {
      baseUrl: "http://accounts.test",
      serviceKey: "secret",
      timeoutMs: 1_000,
      renewalWindowMs: 1_000,
      credentialCacheTtlMs: 60_000,
    },
    fetcher,
  );
  const manager = new WhatsAppCredentialManager(
    accounts,
    { renewalWindowMs: 1_000, credentialCacheTtlMs: 60_000 },
    createLogger({ service: "credential-manager-test" }),
    () => Date.parse("2026-07-29T00:00:00.000Z"),
  );

  await assert.rejects(
    manager.executeByChannel(channelConfigId, async () => {
      throw new MetaWhatsAppError("Invalid token", 401, 190);
    }),
    (error: unknown) =>
      error instanceof Error &&
      "code" in error &&
      error.code === "needs_reauth",
  );
  assert.equal(markedNeedsReauth, true);
});
