/**
 * Decrypt / encrypt secrets stored by Accounts (mail_oauth_connections,
 * setup_email_configs.*_encrypted).
 *
 * Wire format: base64(iv):base64(tag):base64(ciphertext) — AES-256-GCM,
 * 12-byte IV, 16-byte auth tag. Same contract as Accounts oauthCrypto
 * (guidelines/OAUTH_CONNECTOR_DATA_CONTRACT.md).
 *
 * Key material (try in order on decrypt):
 *   1. MS_TOKEN_ENCRYPTION_KEY (preferred; ACCOUNTS_TOKEN_ENCRYPTION_KEY alias)
 *      — 64 hex → 32 bytes; else 32-byte base64; else SHA-256(string)
 *   2. scrypt(MS_CLIENT_SECRET, salt="worktual-mail-oauth", 32)
 *      — legacy when Accounts had no MS_TOKEN_ENCRYPTION_KEY at connect time
 *
 * Encrypt (token rewrite after refresh) prefers MS_TOKEN_ENCRYPTION_KEY so
 * ciphertext migrates off the scrypt fallback.
 */

import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
  scryptSync,
} from "crypto";

const PRIMARY_ENV = "MS_TOKEN_ENCRYPTION_KEY";
const LEGACY_ENV = "ACCOUNTS_TOKEN_ENCRYPTION_KEY";
const CLIENT_SECRET_ENVS = [
  "MS_CLIENT_SECRET",
  "ACCOUNTS_MICROSOFT_CLIENT_SECRET",
  "MICROSOFT_CLIENT_SECRET",
] as const;
const SCRYPT_SALT = "worktual-mail-oauth";

function rawPrimaryEncryptionKey(): string | undefined {
  const primary = process.env[PRIMARY_ENV]?.trim();
  if (primary) return primary;
  const legacy = process.env[LEGACY_ENV]?.trim();
  if (legacy) return legacy;
  return undefined;
}

function rawClientSecret(): string | undefined {
  for (const name of CLIENT_SECRET_ENVS) {
    const v = process.env[name]?.trim();
    if (v) return v;
  }
  return undefined;
}

function keyBytesFromPrimaryRaw(raw: string): Buffer {
  if (/^[0-9a-fA-F]{64}$/.test(raw)) {
    return Buffer.from(raw, "hex");
  }
  try {
    const asB64 = Buffer.from(raw, "base64");
    if (asB64.length === 32) return asB64;
  } catch {
    /* fall through */
  }
  return createHash("sha256").update(raw, "utf8").digest();
}

function keyBytesFromClientSecret(secret: string): Buffer {
  // Node defaults: N=16384, r=8, p=1 — matches Accounts oauthCrypto fallback.
  return scryptSync(secret, SCRYPT_SALT, 32);
}

/** Candidate AES keys for decrypt (primary first, then scrypt fallback). */
function decryptKeyCandidates(): Buffer[] {
  const keys: Buffer[] = [];
  const seen = new Set<string>();
  const push = (key: Buffer) => {
    const id = key.toString("hex");
    if (seen.has(id)) return;
    seen.add(id);
    keys.push(key);
  };

  const primary = rawPrimaryEncryptionKey();
  if (primary) push(keyBytesFromPrimaryRaw(primary));

  const secret = rawClientSecret();
  if (secret) push(keyBytesFromClientSecret(secret));

  return keys;
}

/** Preferred key for encrypt / token rewrite. */
function encryptKeyBytes(): Buffer {
  const primary = rawPrimaryEncryptionKey();
  if (primary) return keyBytesFromPrimaryRaw(primary);
  const secret = rawClientSecret();
  if (secret) return keyBytesFromClientSecret(secret);
  throw new Error(
    `${PRIMARY_ENV} (or ${CLIENT_SECRET_ENVS[0]} for scrypt fallback) is not set — required to use the Accounts CRM bot mailbox.`,
  );
}

export function accountsTokenEncryptionConfigured(): boolean {
  return Boolean(rawPrimaryEncryptionKey() || rawClientSecret());
}

function decryptWithKey(encrypted: string, key: Buffer): string {
  const parts = encrypted.split(":");
  if (parts.length !== 3) {
    throw new Error("Invalid Accounts encrypted secret format.");
  }
  const [ivB64, tagB64, dataB64] = parts;
  const iv = Buffer.from(ivB64, "base64");
  const tag = Buffer.from(tagB64, "base64");
  const data = Buffer.from(dataB64, "base64");
  if (iv.length !== 12 || tag.length !== 16) {
    throw new Error("Unexpected Accounts cipher IV/tag lengths.");
  }
  const decipher = createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(data), decipher.final()]).toString(
    "utf8",
  );
}

/** Decrypt Accounts `iv:tag:ciphertext` payload (tries primary + scrypt keys). */
export function decryptAccountsSecret(encrypted: string): string {
  const keys = decryptKeyCandidates();
  if (keys.length === 0) {
    throw new Error(
      `${PRIMARY_ENV} (or ${CLIENT_SECRET_ENVS[0]} for scrypt fallback) is not set — required to use the Accounts CRM bot mailbox.`,
    );
  }

  let lastErr: unknown;
  for (const key of keys) {
    try {
      return decryptWithKey(encrypted, key);
    } catch (err) {
      lastErr = err;
    }
  }
  throw lastErr instanceof Error
    ? lastErr
    : new Error("Failed to decrypt Accounts secret with available keys.");
}

/** Encrypt plaintext for writing back refreshed OAuth tokens. */
export function encryptAccountsSecret(plaintext: string): string {
  const key = encryptKeyBytes();
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const ciphertext = Buffer.concat([
    cipher.update(plaintext, "utf8"),
    cipher.final(),
  ]);
  const tag = cipher.getAuthTag();
  return [
    iv.toString("base64"),
    tag.toString("base64"),
    ciphertext.toString("base64"),
  ].join(":");
}
