import assert from "node:assert/strict";
import { test } from "node:test";

import {
  decryptStoredToken,
  encryptStoredToken,
  encryptionKeyFromHex,
  StoredTokenDecryptError,
} from "../lib/ms-graph-crypto.js";

const primaryKeyHex =
  "af9d21563d82c178667371d2de5bb32a7a956d5c082a711410791d24d38400d5";

test("round-trips setup_social_configs AES-256-GCM token format", () => {
  const key = encryptionKeyFromHex(primaryKeyHex);
  const encrypted = encryptStoredToken("test-meta-access-token", key);
  const parts = encrypted.split(":");

  assert.equal(parts.length, 3);
  assert.equal(Buffer.from(parts[0]!, "base64").length, 12);
  assert.equal(Buffer.from(parts[1]!, "base64").length, 16);
  assert.equal(decryptStoredToken(encrypted, key), "test-meta-access-token");
});

test("rejects tokens encrypted with a different key", () => {
  const key = Buffer.alloc(32, 1);
  const wrongKey = Buffer.alloc(32, 2);
  const encrypted = encryptStoredToken("test-meta-access-token", key);

  assert.throws(
    () => decryptStoredToken(encrypted, wrongKey),
    (error: unknown) =>
      error instanceof StoredTokenDecryptError &&
      error.code === "auth_tag_mismatch",
  );
});
