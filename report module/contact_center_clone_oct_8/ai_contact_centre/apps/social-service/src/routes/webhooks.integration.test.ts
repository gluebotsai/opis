import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { test } from "node:test";
import pino from "pino";

import { buildApp } from "../app.js";
import type { SocialServiceConfig } from "../config.js";
import type { SocialLoggers } from "../lib/logging.js";
import { MetaWhatsAppClient } from "../providers/meta-whatsapp.js";
import { AccountsClient } from "../services/accounts-client.js";

function createTestLoggers(): SocialLoggers {
  const logger = pino({ level: "silent" });
  return {
    app: logger,
    webhooks: logger,
    messages: logger,
    instagram: logger,
    facebook: logger,
  };
}

const channelConfigId = "11111111-1111-4111-8111-111111111111";
const organizationId = "22222222-2222-4222-8222-222222222222";

const config: SocialServiceConfig = {
  port: 3004,
  serviceName: "social-service-test",
  internalServiceKey: "internal-secret",
  directCredentialStore: null,
  accounts: {
    baseUrl: "http://accounts.test",
    serviceKey: "accounts-secret",
    timeoutMs: 1_000,
    renewalWindowMs: 1_000,
    credentialCacheTtlMs: 60_000,
  },
  metaWhatsApp: {
    verifyToken: "verify-me",
    appSecret: "meta-app-secret",
    appId: "meta-app-id",
    graphApiVersion: "v22.0",
    markRead: false,
    autoReply: false,
    autoReplyMessage: "test reply",
    autoReplyTemplate: null,
    autoReplyButtons: false,
    autoReplyButtonBody: "Choose an option:",
    autoReplyButtonList: [
      { id: "btn_option_1", title: "Option 1" },
      { id: "btn_option_2", title: "Option 2" },
    ],
  },
  metaMessenger: null,
};

const runtimeCredentials = {
  channelConfigId,
  organizationId,
  provider: "whatsapp",
  connectionStatus: "connected",
  phoneNumberId: "123456789",
  wabaId: "987654321",
  accessToken: "tenant-access-token",
  tokenExpiresAt: "2099-09-01T00:00:00.000Z",
};

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

test("inbound webhook posts to cc-core and returns accepted count", async () => {
  let ingestCalled = false;

  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async (input, init) => {
    const url = String(input);
    if (url.includes("/internal/v1/social/conversations")) {
      ingestCalled = true;
      return jsonResponse({
        conversationId: "33333333-3333-4333-8333-333333333333",
        messageId: "44444444-4444-4444-8444-444444444444",
        created: true,
        duplicate: false,
        botEligible: true,
        conversation: { id: "33333333-3333-4333-8333-333333333333", status: "bot_active" },
      });
    }
    if (url.includes("/internal/v1/social/whatsapp/configs/by-phone-number/")) {
      return jsonResponse(runtimeCredentials);
    }
    return originalFetch(input, init);
  }) as typeof fetch;

  const accountsClient = new AccountsClient(config.accounts!, async (input) => {
    assert.match(String(input), /by-phone-number/);
    return jsonResponse(runtimeCredentials);
  });
  const metaClient = new MetaWhatsAppClient(
    config.metaWhatsApp!,
    async () => jsonResponse({ messaging_product: "whatsapp", messages: [{ id: "wamid.stub" }] }),
  );
  const app = await buildApp(config, createTestLoggers(), { accountsClient, metaClient });

  try {
    const payload = JSON.stringify({
      object: "whatsapp_business_account",
      entry: [
        {
          id: "waba",
          changes: [
            {
              field: "messages",
              value: {
                messaging_product: "whatsapp",
                metadata: { phone_number_id: "123456789" },
                contacts: [{ wa_id: "919876543210", profile: { name: "Customer" } }],
                messages: [
                  {
                    id: "wamid-integration",
                    from: "919876543210",
                    timestamp: "1785283200",
                    type: "text",
                    text: { body: "Integration hello" },
                  },
                ],
              },
            },
          ],
        },
      ],
    });
    const signature = createHmac("sha256", config.metaWhatsApp!.appSecret!)
      .update(payload)
      .digest("hex");

    const webhook = await app.inject({
      method: "POST",
      url: "/webhooks/whatsapp",
      headers: {
        "content-type": "application/json",
        "x-hub-signature-256": `sha256=${signature}`,
      },
      payload,
    });

    assert.equal(webhook.statusCode, 200);
    assert.equal(webhook.json().inboundMessages, 1);
    assert.equal(ingestCalled, true);
  } finally {
    globalThis.fetch = originalFetch;
    await app.close();
  }
});
