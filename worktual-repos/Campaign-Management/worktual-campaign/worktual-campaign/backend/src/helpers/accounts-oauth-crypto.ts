/**
 * Decrypt secrets stored by My Accounts (Setup Workspace).
 * Format: base64(iv):base64(tag):base64(ciphertext) — AES-256-GCM.
 * Key: MS_TOKEN_ENCRYPTION_KEY (32-byte material, hashed if not exactly 32 bytes).
 */

import { createDecipheriv, createHash } from "node:crypto";
import { env } from "../config/env.js";

function encryptionKey(): Buffer {
  const raw = env.accountsOAuth.msTokenEncryptionKey;
  if (!raw) {
    throw new Error(
      "MS_TOKEN_ENCRYPTION_KEY is not configured — cannot decrypt Accounts mailbox secrets.",
    );
  }
  if (/^[0-9a-fA-F]{64}$/.test(raw)) {
    return Buffer.from(raw, "hex");
  }
  try {
    const b64 = Buffer.from(raw, "base64");
    if (b64.length === 32) return b64;
  } catch {
    /* fall through */
  }
  return createHash("sha256").update(raw).digest();
}

/** Decrypt Accounts OAuth/SMTP ciphertext. Never log the result. */
export function decryptAccountsSecret(payload: string): string {
  const text = String(payload || "").trim();
  if (!text) throw new Error("Empty encrypted secret");
  const parts = text.split(":");
  if (parts.length !== 3) {
    throw new Error("Invalid Accounts encrypted secret format");
  }
  const [ivB64, tagB64, dataB64] = parts;
  const decipher = createDecipheriv(
    "aes-256-gcm",
    encryptionKey(),
    Buffer.from(ivB64, "base64"),
  );
  decipher.setAuthTag(Buffer.from(tagB64, "base64"));
  return Buffer.concat([
    decipher.update(Buffer.from(dataB64, "base64")),
    decipher.final(),
  ]).toString("utf8");
}

export function accountsCryptoConfigured(): boolean {
  return Boolean(env.accountsOAuth.msTokenEncryptionKey);
}
