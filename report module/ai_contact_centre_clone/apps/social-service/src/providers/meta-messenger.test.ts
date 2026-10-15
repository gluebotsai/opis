import assert from "node:assert/strict";
import { test } from "node:test";

import pino from "pino";

import type { MetaMessengerAppConfig } from "../config.js";
import type { MessengerRuntimeCredentials } from "../types/accounts-contract.js";
import { MessengerCredentialManager } from "../services/messenger-credential-manager.js";
import { AccountsApiError } from "../services/accounts-client.js";
import { MetaMessengerClient } from "./meta-messenger.js";

const config: MetaMessengerAppConfig = {
  facebookVerifyToken: "fb-verify",
  instagramVerifyToken: "ig-verify",
  appSecret: "app-secret",
  appId: "app-id",
  instagramAppSecret: "ig-secret",
  instagramAppId: "ig-app-id",
  graphApiVersion: "v26.0",
  autoReply: false,
  autoReplyMessage: "reply",
  autoReplyButtons: false,
  autoReplyButtonBody: "Choose:",
  autoReplyButtonList: [
    { id: "one", title: "One" },
    { id: "two", title: "Two" },
  ],
};

function credentials(
  overrides: Partial<MessengerRuntimeCredentials> = {},
): MessengerRuntimeCredentials {
  return {
    channelConfigId: "11111111-1111-4111-8111-111111111111",
    organizationId: "22222222-2222-4222-8222-222222222222",
    provider: "instagram",
    connectionStatus: "connected",
    pageId: "page-1",
    igBusinessAccountId: "graph-ig-1",
    igWebhookAccountId: null,
    instagramLoginUserId: null,
    instagramLoginScopedId: null,
    authType: "facebook_page",
    metaAppId: "ig-app-id",
    grantedScopes: ["instagram_manage_messages"],
    accessToken: "EAA-page-token",
    tokenExpiresAt: "2099-09-01T00:00:00.000Z",
    ...overrides,
  };
}

test("uses Page messaging endpoint for primary facebook_page auth", async () => {
  let calledUrl = "";
  let calledBody: unknown;
  const client = new MetaMessengerClient(config, async (input, init) => {
    calledUrl = String(input);
    calledBody = JSON.parse(String(init?.body));
    return new Response(
      JSON.stringify({ recipient_id: "igsid-1", message_id: "mid-1" }),
      { status: 200, headers: { "Content-Type": "application/json" } },
    );
  });

  await client.sendTextMessage(credentials(), "igsid-1", "Hello");

  assert.equal(
    calledUrl,
    "https://graph.facebook.com/v26.0/page-1/messages",
  );
  assert.deepEqual(calledBody, {
    messaging_product: "instagram",
    recipient: { id: "igsid-1" },
    message: { text: "Hello" },
  });
});

test("uses Instagram endpoint only for explicit instagram_login auth", async () => {
  let calledUrl = "";
  let calledBody: unknown;
  const client = new MetaMessengerClient(config, async (input, init) => {
    calledUrl = String(input);
    calledBody = JSON.parse(String(init?.body));
    return new Response(
      JSON.stringify({ recipient_id: "igsid-1", message_id: "mid-1" }),
      { status: 200, headers: { "Content-Type": "application/json" } },
    );
  });

  await client.sendTextMessage(
    credentials({
      authType: "instagram_login",
      accessToken: "IGAA-login-token",
      grantedScopes: ["instagram_business_manage_messages"],
    }),
    "igsid-1",
    "Hello",
  );

  assert.equal(
    calledUrl,
    "https://graph.instagram.com/v26.0/me/messages",
  );
  assert.deepEqual(calledBody, {
    recipient: { id: "igsid-1" },
    message: { text: "Hello" },
  });
});

test("binds webhook id separately from Graph business id", async () => {
  const graphCredentials = credentials();
  let bound:
    | { channelConfigId: string; webhookEntryId: string }
    | undefined;
  const manager = new MessengerCredentialManager(
    {
      getByPageId: async () => {
        throw new AccountsApiError(
          "configuration_not_found",
          "not found",
          404,
          false,
        );
      },
      getByIgBusinessAccountId: async () => {
        throw new AccountsApiError(
          "configuration_not_found",
          "not found",
          404,
          false,
        );
      },
      getByInstagramWebhookAccountId: async () => {
        throw new AccountsApiError(
          "configuration_not_found",
          "not found",
          404,
          false,
        );
      },
      getByChannelConfigId: async () => graphCredentials,
      listConnectedInstagram: async () => [graphCredentials],
      bindInstagramWebhookEntryId: async (
        channelConfigId,
        webhookEntryId,
      ) => {
        bound = { channelConfigId, webhookEntryId };
      },
      renew: async () => graphCredentials,
      markNeedsReauth: async () => undefined,
    },
    { renewalWindowMs: 1_000, credentialCacheTtlMs: 60_000 },
    pino({ level: "silent" }),
  );

  const resolved = await manager.resolveInstagramWebhookEntry(
    "webhook-ig-1",
    async () => ({ id: "scoped-1", user_id: "graph-ig-1" }),
  );

  assert.equal(resolved.igBusinessAccountId, "graph-ig-1");
  assert.equal(resolved.igWebhookAccountId, "webhook-ig-1");
  assert.deepEqual(bound, {
    channelConfigId: graphCredentials.channelConfigId,
    webhookEntryId: "webhook-ig-1",
  });
});
