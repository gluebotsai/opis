/**
 * Encrypt gateway secrets at rest (same AES-256-GCM wire format as Accounts OAuth).
 */
import {
  decryptAccountsSecret,
  encryptAccountsSecret,
  accountsTokenEncryptionConfigured,
} from "@/service/account/accounts-token-crypto";

export { accountsTokenEncryptionConfigured };

export function encryptGatewaySecret(plaintext: string): string {
  return encryptAccountsSecret(plaintext);
}

export function decryptGatewaySecret(encrypted: string): string {
  return decryptAccountsSecret(encrypted);
}

/** Mask a secret for API responses — show last 4 chars only. */
export function maskSecret(value: string | null | undefined): string | null {
  if (!value?.trim()) return null;
  const v = value.trim();
  if (v.length <= 4) return "****";
  return `****${v.slice(-4)}`;
}

export function isMaskedPlaceholder(value: string | undefined): boolean {
  return Boolean(value?.startsWith("****"));
}
