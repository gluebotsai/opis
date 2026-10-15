import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { test } from "node:test";
import pino from "pino";

import { buildApp } from "../app.js";
import type {
  MetaMessengerAppConfig,
  MetaWhatsAppAppConfig,
  SocialServiceConfig,
} from "../config.js";
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

const channelConfigId = "1001";
const organizationId = "1000";

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

test("sends text, template, and read receipt with tenant credentials", async () => {
  const metaPayloads: Array<Record<string, unknown>> = [];

  const accountsClient = new AccountsClient(config.accounts!, async () =>
    jsonResponse(runtimeCredentials),
  );
  const metaClient = new MetaWhatsAppClient(
    config.metaWhatsApp!,
    async (_input, init) => {
      assert.equal(
        (init?.headers as Record<string, string>).Authorization,
        "Bearer tenant-access-token",
      );
      metaPayloads.push(JSON.parse(String(init?.body)) as Record<string, unknown>);
      return jsonResponse({
        messaging_product: "whatsapp",
        contacts: [{ input: "919876543210", wa_id: "919876543210" }],
        messages: [{ id: `wamid-${metaPayloads.length}` }],
      });
    },
  );
  const app = await buildApp(
    config,
    createTestLoggers(),
    { accountsClient, metaClient },
  );

  try {
    const headers = {
      "content-type": "application/json",
      "x-internal-service-key": "internal-secret",
    };
    const text = await app.inject({
      method: "POST",
      url: "/internal/v1/whatsapp/messages",
      headers,
      payload: {
        channelConfigId,
        to: "+91 98765 43210",
        body: "Hello",
        previewUrl: true,
      },
    });
    assert.equal(text.statusCode, 200);
    assert.equal(text.json().providerMessageId, "wamid-1");
    assert.deepEqual(metaPayloads[0]?.text, {
      body: "Hello",
      preview_url: true,
    });

    const template = await app.inject({
      method: "POST",
      url: "/internal/v1/whatsapp/templates",
      headers,
      payload: {
        channelConfigId,
        to: "919876543210",
        templateName: "order_update",
        languageCode: "en_US",
        components: [
          {
            type: "body",
            parameters: [{ type: "text", text: "ORD-1234" }],
          },
        ],
      },
    });
    assert.equal(template.statusCode, 200);
    assert.equal(
      (metaPayloads[1]?.template as { name: string }).name,
      "order_update",
    );

    const read = await app.inject({
      method: "POST",
      url: "/internal/v1/whatsapp/messages/wamid-inbound/read",
      headers,
      payload: { channelConfigId },
    });
    assert.equal(read.statusCode, 200);
    assert.equal(metaPayloads[2]?.status, "read");
    assert.equal(metaPayloads[2]?.message_id, "wamid-inbound");
    assert.equal(metaPayloads[2]?.typing_indicator, undefined);
  } finally {
    await app.close();
  }
});

test("verifies and resolves signed inbound WhatsApp webhooks", async () => {
  let accountLookupPath = "";
  const accountsClient = new AccountsClient(config.accounts!, async (input) => {
    accountLookupPath = new URL(String(input)).pathname;
    return jsonResponse(runtimeCredentials);
  });
  const metaClient = new MetaWhatsAppClient(
    config.metaWhatsApp!,
    async () => jsonResponse({ messaging_product: "whatsapp", contacts: [], messages: [] }),
  );
  const app = await buildApp(
    config,
    createTestLoggers(),
    { accountsClient, metaClient },
  );

  try {
    const verification = await app.inject({
      method: "GET",
      url: "/webhooks/whatsapp?hub.mode=subscribe&hub.verify_token=verify-me&hub.challenge=12345",
    });
    assert.equal(verification.statusCode, 200);
    assert.equal(verification.body, "12345");

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
                    id: "wamid-inbound",
                    from: "919876543210",
                    timestamp: "1785283200",
                    type: "text",
                    text: { body: "Hello" },
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
    assert.equal(
      accountLookupPath,
      "/internal/v1/social/whatsapp/configs/by-phone-number/123456789",
    );
  } finally {
    await app.close();
  }
});

test("submits template approval and fetches approval status", async () => {
  const graphCalls: Array<{ url: string; method: string; body?: unknown }> = [];

  const accountsClient = new AccountsClient(config.accounts!, async () =>
    jsonResponse(runtimeCredentials),
  );
  const metaClient = new MetaWhatsAppClient(
    config.metaWhatsApp!,
    async (input, init) => {
      const method = init?.method ?? "GET";
      const body = init?.body ? JSON.parse(String(init.body)) : undefined;
      graphCalls.push({ url: String(input), method, body });

      if (String(input).includes("/message_templates") && method === "POST") {
        return jsonResponse({
          id: "tpl-123",
          status: "PENDING",
          category: "UTILITY",
        });
      }
      if (String(input).includes("/message_templates") && method === "GET") {
        return jsonResponse({
          data: [
            {
              id: "tpl-123",
              name: "worktual_test_buttons",
              language: "en",
              status: "APPROVED",
              category: "UTILITY",
              rejected_reason: null,
            },
          ],
        });
      }

      return jsonResponse({
        messaging_product: "whatsapp",
        contacts: [],
        messages: [{ id: "wamid-fallback" }],
      });
    },
  );
  const app = await buildApp(
    config,
    createTestLoggers(),
    { accountsClient, metaClient },
  );

  try {
    const headers = {
      "content-type": "application/json",
      "x-internal-service-key": "internal-secret",
    };
    const submit = await app.inject({
      method: "POST",
      url: "/internal/v1/whatsapp/templates/submit-approval",
      headers,
      payload: {
        channelConfigId,
        name: "worktual_test_buttons",
        language: "en",
        category: "UTILITY",
        components: [
          {
            type: "BODY",
            text: "Thanks for contacting Worktual. How can we help?",
          },
          {
            type: "BUTTONS",
            buttons: [
              { type: "QUICK_REPLY", text: "Sales" },
              { type: "QUICK_REPLY", text: "Support" },
            ],
          },
        ],
      },
    });

    assert.equal(submit.statusCode, 200);
    assert.equal(submit.json().submitted, true);
    assert.equal(submit.json().templateId, "tpl-123");
    assert.equal(submit.json().status, "PENDING");
    assert.match(graphCalls[0]?.url ?? "", /\/987654321\/message_templates$/);
    assert.equal(graphCalls[0]?.method, "POST");
    assert.equal(
      (graphCalls[0]?.body as { components: Array<{ type: string }> }).components[1]?.type,
      "BUTTONS",
    );

    const status = await app.inject({
      method: "GET",
      url:
        "/internal/v1/whatsapp/templates/approval-status" +
        `?channelConfigId=${channelConfigId}&templateName=worktual_test_buttons&language=en`,
      headers: {
        "x-internal-service-key": "internal-secret",
      },
    });

    assert.equal(status.statusCode, 200);
    assert.equal(status.json().templates.length, 1);
    assert.equal(status.json().templates[0].status, "APPROVED");
    assert.equal(status.json().templates[0].name, "worktual_test_buttons");
    assert.match(graphCalls[1]?.url ?? "", /\/987654321\/message_templates\?/);
    assert.match(graphCalls[1]?.url ?? "", /name=worktual_test_buttons/);
  } finally {
    await app.close();
  }
});

test("lists all whatsapp templates and status for a channel", async () => {
  const graphCalls: string[] = [];

  const accountsClient = new AccountsClient(config.accounts!, async () =>
    jsonResponse(runtimeCredentials),
  );
  const metaClient = new MetaWhatsAppClient(
    config.metaWhatsApp!,
    async (input, _init) => {
      graphCalls.push(String(input));
      if (String(input).includes("/message_templates")) {
        if (graphCalls.length === 1) {
          return jsonResponse({
            data: [
              {
                id: "tpl-1",
                name: "order_update",
                language: "en",
                status: "APPROVED",
                category: "UTILITY",
                rejected_reason: null,
              },
              {
                id: "tpl-2",
                name: "promo_offer",
                language: "en",
                status: "PENDING",
                category: "MARKETING",
                rejected_reason: null,
              },
            ],
            paging: {
              next: "https://graph.facebook.com/v22.0/987654321/message_templates?after=cursor-1",
            },
          });
        }
        return jsonResponse({
          data: [
            {
              id: "tpl-3",
              name: "welcome",
              language: "en_US",
              status: "APPROVED",
              category: "UTILITY",
              rejected_reason: null,
            },
          ],
        });
      }

      return jsonResponse({
        messaging_product: "whatsapp",
        contacts: [],
        messages: [{ id: "wamid-fallback" }],
      });
    },
  );
  const app = await buildApp(
    config,
    createTestLoggers(),
    { accountsClient, metaClient },
  );

  try {
    const list = await app.inject({
      method: "GET",
      url:
        `/internal/v1/whatsapp/templates?channelConfigId=${channelConfigId}` +
        "&status=APPROVED&language=en",
      headers: {
        "x-internal-service-key": "internal-secret",
      },
    });

    assert.equal(list.statusCode, 200);
    assert.equal(list.json().count, 1);
    assert.equal(list.json().templates.length, 1);
    assert.equal(list.json().templates[0].name, "order_update");
    assert.equal(list.json().templates[0].status, "APPROVED");
    assert.equal(list.json().templates[0].components, undefined);
    assert.equal(graphCalls.length, 2);
    assert.match(graphCalls[0] ?? "", /\/987654321\/message_templates\?/);
    assert.equal((graphCalls[0] ?? "").includes("components"), false);
    assert.match(graphCalls[1] ?? "", /after=cursor-1/);
  } finally {
    await app.close();
  }
});

test("lists whatsapp templates with full components when return_template=true", async () => {
  const graphCalls: string[] = [];

  const accountsClient = new AccountsClient(config.accounts!, async () =>
    jsonResponse(runtimeCredentials),
  );
  const metaClient = new MetaWhatsAppClient(
    config.metaWhatsApp!,
    async (input) => {
      graphCalls.push(String(input));
      return jsonResponse({
        data: [
          {
            id: "tpl-1",
            name: "order_update",
            language: "en",
            status: "APPROVED",
            category: "UTILITY",
            rejected_reason: null,
            components: [
              { type: "BODY", text: "Your order {{1}} is ready." },
              {
                type: "BUTTONS",
                buttons: [{ type: "QUICK_REPLY", text: "Track" }],
              },
            ],
          },
        ],
      });
    },
  );
  const app = await buildApp(
    config,
    createTestLoggers(),
    { accountsClient, metaClient },
  );

  try {
    const list = await app.inject({
      method: "GET",
      url:
        `/internal/v1/whatsapp/templates?channelConfigId=${channelConfigId}` +
        "&return_template=true",
      headers: {
        "x-internal-service-key": "internal-secret",
      },
    });

    assert.equal(list.statusCode, 200);
    assert.equal(list.json().count, 1);
    assert.equal(list.json().templates[0].name, "order_update");
    assert.deepEqual(list.json().templates[0].components, [
      { type: "BODY", text: "Your order {{1}} is ready." },
      {
        type: "BUTTONS",
        buttons: [{ type: "QUICK_REPLY", text: "Track" }],
      },
    ]);
    assert.match(graphCalls[0] ?? "", /components/);
  } finally {
    await app.close();
  }
});

test("fetches a single whatsapp template by name with full components", async () => {
  const graphCalls: string[] = [];

  const accountsClient = new AccountsClient(config.accounts!, async () =>
    jsonResponse(runtimeCredentials),
  );
  const metaClient = new MetaWhatsAppClient(
    config.metaWhatsApp!,
    async (input) => {
      graphCalls.push(String(input));
      return jsonResponse({
        data: [
          {
            id: "tpl-42",
            name: "summer_sale_2026",
            language: "en",
            status: "APPROVED",
            category: "MARKETING",
            rejected_reason: null,
            components: [{ type: "BODY", text: "Sale ends tonight!" }],
          },
          {
            id: "tpl-43",
            name: "summer_sale_2026",
            language: "hi",
            status: "APPROVED",
            category: "MARKETING",
            rejected_reason: null,
            components: [{ type: "BODY", text: "Sale Hindi" }],
          },
        ],
      });
    },
  );
  const app = await buildApp(
    config,
    createTestLoggers(),
    { accountsClient, metaClient },
  );

  try {
    const detail = await app.inject({
      method: "GET",
      url:
        "/internal/v1/whatsapp/templates/detail" +
        `?channelConfigId=${channelConfigId}` +
        "&templateName=summer_sale_2026&language=en",
      headers: {
        "x-internal-service-key": "internal-secret",
      },
    });

    assert.equal(detail.statusCode, 200);
    assert.equal(detail.json().template.id, "tpl-42");
    assert.equal(detail.json().template.name, "summer_sale_2026");
    assert.equal(detail.json().template.language, "en");
    assert.deepEqual(detail.json().template.components, [
      { type: "BODY", text: "Sale ends tonight!" },
    ]);
    assert.match(graphCalls[0] ?? "", /name=summer_sale_2026/);
    assert.match(graphCalls[0] ?? "", /components/);
  } finally {
    await app.close();
  }
});

test("returns 404 when single whatsapp template is missing", async () => {
  const accountsClient = new AccountsClient(config.accounts!, async () =>
    jsonResponse(runtimeCredentials),
  );
  const metaClient = new MetaWhatsAppClient(
    config.metaWhatsApp!,
    async () => jsonResponse({ data: [] }),
  );
  const app = await buildApp(
    config,
    createTestLoggers(),
    { accountsClient, metaClient },
  );

  try {
    const detail = await app.inject({
      method: "GET",
      url:
        "/internal/v1/whatsapp/templates/detail" +
        `?channelConfigId=${channelConfigId}&templateName=missing_template`,
      headers: {
        "x-internal-service-key": "internal-secret",
      },
    });

    assert.equal(detail.statusCode, 404);
    assert.equal(detail.json().error.code, "template_not_found");
  } finally {
    await app.close();
  }
});

test("sends text auto-reply and interactive buttons on inbound webhook", async () => {
  const metaPayloads: Array<Record<string, unknown>> = [];
  const webhookConfig: MetaWhatsAppAppConfig = {
    ...config.metaWhatsApp!,
    autoReply: true,
    autoReplyMessage: "Thanks for your message!",
    autoReplyButtons: true,
    autoReplyButtonBody: "Pick a test option:",
    autoReplyButtonList: [
      { id: "btn_sales", title: "Sales" },
      { id: "btn_support", title: "Support" },
    ],
  };

  const accountsClient = new AccountsClient(config.accounts!, async () =>
    jsonResponse(runtimeCredentials),
  );
  const metaClient = new MetaWhatsAppClient(webhookConfig, async (_input, init) => {
    metaPayloads.push(JSON.parse(String(init?.body)) as Record<string, unknown>);
    return jsonResponse({
      messaging_product: "whatsapp",
      contacts: [{ input: "919876543210", wa_id: "919876543210" }],
      messages: [{ id: `wamid-${metaPayloads.length}` }],
    });
  });
  const app = await buildApp(
    { ...config, metaWhatsApp: webhookConfig },
    createTestLoggers(),
    { accountsClient, metaClient },
  );

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
                    id: "wamid-inbound",
                    from: "919876543210",
                    timestamp: "1785283200",
                    type: "text",
                    text: { body: "Hello" },
                  },
                ],
              },
            },
          ],
        },
      ],
    });
    const signature = createHmac("sha256", webhookConfig.appSecret!)
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
    assert.equal(webhook.json().repliesSent, 1);
    assert.equal(webhook.json().buttonRepliesSent, 1);
    assert.equal(metaPayloads.length, 2);
    assert.deepEqual(metaPayloads[0]?.text, {
      body: "Thanks for your message!",
      preview_url: false,
    });
    assert.equal(metaPayloads[1]?.type, "interactive");
    assert.deepEqual(
      (metaPayloads[1]?.interactive as { body: { text: string } }).body,
      { text: "Pick a test option:" },
    );
    const buttons = (
      (metaPayloads[1]?.interactive as {
        action: { buttons: Array<{ reply: { id: string; title: string } }> };
      }).action.buttons
    );
    assert.deepEqual(buttons, [
      { type: "reply", reply: { id: "btn_sales", title: "Sales" } },
      { type: "reply", reply: { id: "btn_support", title: "Support" } },
    ]);
  } finally {
    await app.close();
  }
});

test("verifies facebook webhook and sends messenger text", async () => {
  const graphCalls: Array<{ url: string; method: string; body?: unknown }> = [];
  const pageId = "page-555";
  const messengerConfig: MetaMessengerAppConfig = {
    facebookVerifyToken: "fb-verify",
    instagramVerifyToken: "ig-verify",
    appSecret: "meta-app-secret",
    appId: "meta-app-id",
    instagramAppSecret: "meta-app-secret",
    instagramAppId: "meta-app-id",
    graphApiVersion: "v22.0",
    autoReply: false,
    autoReplyMessage: "messenger reply",
    autoReplyButtons: false,
    autoReplyButtonBody: "Choose:",
    autoReplyButtonList: [
      { id: "btn_option_1", title: "Option 1" },
      { id: "btn_option_2", title: "Option 2" },
    ],
  };

  const messengerCredentials = {
    channelConfigId,
    organizationId,
    provider: "facebook" as const,
    connectionStatus: "connected" as const,
    pageId,
    igBusinessAccountId: null,
    accessToken: "page-access-token",
    tokenExpiresAt: "2099-09-01T00:00:00.000Z",
  };

  const { MessengerCredentialManager } = await import(
    "../services/messenger-credential-manager.js"
  );
  const { MetaMessengerClient } = await import("../providers/meta-messenger.js");

  const messengerCredentialManager = new MessengerCredentialManager(
    {
      getByPageId: async () => messengerCredentials,
      getByIgBusinessAccountId: async () => {
        throw new Error("not used");
      },
      getByChannelConfigId: async () => messengerCredentials,
      renew: async () => messengerCredentials,
      markNeedsReauth: async () => undefined,
    },
    {
      renewalWindowMs: 1_000,
      credentialCacheTtlMs: 60_000,
    },
    pino({ level: "silent" }),
  );

  const messengerClient = new MetaMessengerClient(messengerConfig, async (input, init) => {
    graphCalls.push({
      url: String(input),
      method: init?.method ?? "GET",
      body: init?.body ? JSON.parse(String(init.body)) : undefined,
    });
    return new Response(JSON.stringify({ recipient_id: "psid-1", message_id: "mid-out-1" }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  });

  const app = await buildApp(
    {
      ...config,
      metaMessenger: messengerConfig,
      directCredentialStore: {
        encryptionKey: "af9d21563d82c178667371d2de5bb32a7a956d5c082a711410791d24d38400d5",
        renewalWindowMs: 1_000,
        credentialCacheTtlMs: 60_000,
      },
    },
    createTestLoggers(),
    {
      accountsClient: new AccountsClient(config.accounts!, async () =>
        jsonResponse(runtimeCredentials),
      ),
      messengerClient,
      messengerCredentialManager,
    },
  );

  try {
    const verification = await app.inject({
      method: "GET",
      url: "/webhooks/facebook?hub.mode=subscribe&hub.verify_token=fb-verify&hub.challenge=999",
    });
    assert.equal(verification.statusCode, 200);
    assert.equal(verification.body, "999");

    const send = await app.inject({
      method: "POST",
      url: "/internal/v1/facebook/messages",
      headers: {
        "content-type": "application/json",
        "x-internal-service-key": "internal-secret",
      },
      payload: {
        channelConfigId,
        to: "psid-1",
        body: "Hello from Facebook",
      },
    });
    assert.equal(send.statusCode, 200);
    assert.equal(send.json().providerMessageId, "mid-out-1");
    assert.match(graphCalls[0]?.url ?? "", /\/page-555\/messages$/);
    assert.deepEqual(graphCalls[0]?.body, {
      recipient: { id: "psid-1" },
      message: { text: "Hello from Facebook" },
    });

    const payload = JSON.stringify({
      object: "page",
      entry: [
        {
          id: pageId,
          messaging: [
            {
              sender: { id: "psid-1" },
              recipient: { id: pageId },
              timestamp: 1785283200000,
              message: { mid: "mid-in-1", text: "Hi page" },
            },
          ],
        },
      ],
    });
    const signature = createHmac("sha256", messengerConfig.appSecret!)
      .update(payload)
      .digest("hex");
    const webhook = await app.inject({
      method: "POST",
      url: "/webhooks/facebook",
      headers: {
        "content-type": "application/json",
        "x-hub-signature-256": `sha256=${signature}`,
      },
      payload,
    });
    assert.equal(webhook.statusCode, 200);
    assert.equal(webhook.json().inboundMessages, 1);
    assert.equal(webhook.json().channelType, "facebook");
  } finally {
    await app.close();
  }
});

test("dual-mounts WhatsApp template APIs under WEBHOOK_PUBLIC_PREFIX", async () => {
  const previousPrefix = process.env.WEBHOOK_PUBLIC_PREFIX;
  process.env.WEBHOOK_PUBLIC_PREFIX = "/social-api";
  const app = await buildApp(config, createTestLoggers());

  try {
    const health = await app.inject({ method: "GET", url: "/social-api/health" });
    assert.equal(health.statusCode, 200);
    assert.equal(health.json().service, "social-service-test");

    const prefixed = await app.inject({
      method: "GET",
      url: "/social-api/internal/v1/whatsapp/templates?channelConfigId=1032",
    });
    assert.equal(prefixed.statusCode, 401);
    assert.equal(prefixed.json().error.code, "unauthorized");

    const unprefixed = await app.inject({
      method: "GET",
      url: "/internal/v1/whatsapp/templates?channelConfigId=1032",
    });
    assert.equal(unprefixed.statusCode, 401);
  } finally {
    await app.close();
    if (previousPrefix === undefined) {
      delete process.env.WEBHOOK_PUBLIC_PREFIX;
    } else {
      process.env.WEBHOOK_PUBLIC_PREFIX = previousPrefix;
    }
  }
});
