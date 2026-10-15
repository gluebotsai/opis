import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

export type StoredTokenDecryptErrorCode =
  | "invalid_structure"
  | "invalid_key_length"
  | "auth_tag_mismatch";

export class StoredTokenDecryptError extends Error {
  constructor(
    readonly code: StoredTokenDecryptErrorCode,
    message: string,
    readonly cause?: unknown,
  ) {
    super(message);
    this.name = "StoredTokenDecryptError";
  }
}

export function encryptionKeyFromHex(hexKey: string): Buffer {
  if (!/^[0-9a-fA-F]{64}$/.test(hexKey)) {
    throw new StoredTokenDecryptError(
      "invalid_key_length",
      "MS_TOKEN_ENCRYPTION_KEY must be a 64-character hexadecimal key",
    );
  }
  return Buffer.from(hexKey, "hex");
}

export function decryptStoredToken(value: string, key: Buffer): string {
  if (key.length !== 32) {
    throw new StoredTokenDecryptError(
      "invalid_key_length",
      "Encryption key must be 32 bytes",
    );
  }

  const [ivValue, authTagValue, ciphertextValue, ...extra] = value.trim().split(":");
  if (!ivValue || !authTagValue || !ciphertextValue || extra.length) {
    throw new StoredTokenDecryptError(
      "invalid_structure",
      "Encrypted token must contain three base64 segments: iv:authTag:ciphertext",
    );
  }

  try {
    const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(ivValue, "base64"));
    decipher.setAuthTag(Buffer.from(authTagValue, "base64"));
    return Buffer.concat([
      decipher.update(Buffer.from(ciphertextValue, "base64")),
      decipher.final(),
    ]).toString("utf8");
  } catch (error) {
    throw new StoredTokenDecryptError(
      "auth_tag_mismatch",
      "Stored token could not be decrypted with MS_TOKEN_ENCRYPTION_KEY",
      error,
    );
  }
}

export function encryptStoredToken(value: string, key: Buffer): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const ciphertext = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
  return [
    iv.toString("base64"),
    cipher.getAuthTag().toString("base64"),
    ciphertext.toString("base64"),
  ].join(":");
}
