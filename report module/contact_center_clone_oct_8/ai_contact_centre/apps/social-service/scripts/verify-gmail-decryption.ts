import "@ai-contact-center/config/load-root-env";
import { ccPrisma } from "@ai-contact-center/db-cc";

import { loadDirectCredentialStoreConfig } from "../src/config.js";
import {
  decryptStoredToken,
  encryptionKeyFromHex,
} from "../src/lib/ms-graph-crypto.js";

const altKeyHex = process.argv[2]?.trim();

async function main() {
  const config = loadDirectCredentialStoreConfig();
  if (!config) {
    console.error("MS_TOKEN_ENCRYPTION_KEY is not configured");
    process.exit(1);
  }

  const primaryKey = encryptionKeyFromHex(config.encryptionKey);
  const altKey = altKeyHex ? encryptionKeyFromHex(altKeyHex) : null;

  await ccPrisma.$executeRaw`SELECT set_config('app.is_staff', 'true', true)`;

  const rows = await ccPrisma.$queryRaw<
    Array<{
      account_email: string;
      access_token_encrypted: string | null;
      refresh_token_encrypted: string | null;
    }>
  >`
    SELECT account_email, access_token_encrypted, refresh_token_encrypted
    FROM accounts.mail_oauth_connections
    WHERE access_token_encrypted IS NOT NULL
    ORDER BY updated_at DESC NULLS LAST
  `;

  if (rows.length === 0) {
    console.log(JSON.stringify({ ok: false, reason: "no_gmail_connections_found" }));
    process.exit(1);
  }

  function tryKey(key: Buffer, token: string | null) {
    if (!token) return { ok: false, reason: "missing_token" };
    try {
      decryptStoredToken(token, key);
      return { ok: true };
    } catch (error) {
      return {
        ok: false,
        reason:
          error instanceof Error && "code" in error
            ? (error as { code?: string }).code
            : "decryption_failed",
      };
    }
  }

  const results = rows.map((row) => ({
    accountEmail: row.account_email,
    envKey: {
      access: tryKey(primaryKey, row.access_token_encrypted),
      refresh: tryKey(primaryKey, row.refresh_token_encrypted),
    },
    altKey: altKey
      ? {
          access: tryKey(altKey, row.access_token_encrypted),
          refresh: tryKey(altKey, row.refresh_token_encrypted),
        }
      : null,
  }));

  console.log(JSON.stringify({ connectionCount: rows.length, results }, null, 2));
  await ccPrisma.$disconnect();
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
