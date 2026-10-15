import assert from "node:assert/strict";
import test from "node:test";

import {
  encryptStoredToken,
  encryptionKeyFromHex,
} from "../lib/ms-graph-crypto.js";
import {
  CCAAS_EMAIL_PRODUCT_ID,
  mapEmailChannelRow,
  type EmailChannelRow,
} from "./credential-store.js";

const encryptionKey = encryptionKeyFromHex(
  "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
);

function sampleRow(overrides: Partial<EmailChannelRow> = {}): EmailChannelRow {
  return {
    channel_config_id: "11111111-1111-4111-8111-111111111111",
    organization_id: "22222222-2222-4222-8222-222222222222",
    oauth_connection_id: "33333333-3333-4333-8333-333333333333",
    ccaas_handler: "bot_then_human",
    account_email: "support@example.com",
    access_token_encrypted: encryptStoredToken("access-token", encryptionKey),
    refresh_token_encrypted: encryptStoredToken("refresh-token", encryptionKey),
    expires_at: new Date("2030-01-01T00:00:00.000Z"),
    ...overrides,
  };
}

test("mapEmailChannelRow uses channel config id as connectionId", () => {
  const runtime = mapEmailChannelRow(sampleRow(), encryptionKey);
  assert.equal(runtime.connectionId, "11111111-1111-4111-8111-111111111111");
  assert.equal(runtime.oauthConnectionId, "33333333-3333-4333-8333-333333333333");
  assert.equal(runtime.accountEmail, "support@example.com");
  assert.equal(runtime.ccaasHandler, "bot_then_human");
  assert.equal(runtime.accessToken, "access-token");
  assert.equal(runtime.refreshToken, "refresh-token");
});

test("mapEmailChannelRow rejects rows without encrypted tokens", () => {
  assert.throws(() =>
    mapEmailChannelRow(sampleRow({ access_token_encrypted: "" }), encryptionKey),
  );
});

test("CCAAS_EMAIL_PRODUCT_ID matches My Account contact-centre product id", () => {
  assert.equal(CCAAS_EMAIL_PRODUCT_ID, "contact-center");
});
