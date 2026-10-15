import "@ai-contact-center/config/load-root-env";
import { ccPrisma } from "@ai-contact-center/db-cc";

import { loadDirectCredentialStoreConfig } from "../src/config.js";
import {
  decryptStoredToken,
  encryptionKeyFromHex,
} from "../src/lib/ms-graph-crypto.js";

const phoneNumberId = process.argv[2]?.trim();

async function main() {
  const config = loadDirectCredentialStoreConfig();
  if (!config) {
    console.error("MS_TOKEN_ENCRYPTION_KEY is not configured");
    process.exit(1);
  }

  const key = encryptionKeyFromHex(config.encryptionKey);

  await ccPrisma.$executeRaw`SELECT set_config('app.is_staff', 'true', true)`;

  const rows = phoneNumberId
    ? await ccPrisma.$queryRaw<
        Array<{ phone_number_id: string; access_token_encrypted: string | null }>
      >`
        SELECT phone_number_id, access_token_encrypted
        FROM accounts.setup_social_configs
        WHERE provider = 'whatsapp'
          AND phone_number_id = ${phoneNumberId}
        LIMIT 1
      `
    : await ccPrisma.$queryRaw<
        Array<{ phone_number_id: string; access_token_encrypted: string | null }>
      >`
        SELECT phone_number_id, access_token_encrypted
        FROM accounts.setup_social_configs
        WHERE provider = 'whatsapp'
          AND access_token_encrypted IS NOT NULL
        LIMIT 1
      `;

  const row = rows[0];
  if (!row?.access_token_encrypted) {
    console.log(
      JSON.stringify({
        ok: false,
        reason: "no_whatsapp_config_found",
        phoneNumberId: phoneNumberId ?? null,
      }),
    );
    process.exit(1);
  }

  const parts = row.access_token_encrypted.split(":");
  try {
    decryptStoredToken(row.access_token_encrypted, key);
    console.log(
      JSON.stringify({
        ok: true,
        phoneNumberId: row.phone_number_id,
        segmentCount: parts.length,
        segmentLengths: parts.map((part) => part.length),
      }),
    );
  } catch (error) {
    console.log(
      JSON.stringify({
        ok: false,
        phoneNumberId: row.phone_number_id,
        segmentCount: parts.length,
        segmentLengths: parts.map((part) => part.length),
        reason:
          error instanceof Error && "code" in error
            ? (error as { code?: string }).code
            : "decryption_failed",
        hint:
          "MS_TOKEN_ENCRYPTION_KEY must match the My Account service that encrypted access_token_encrypted.",
      }),
    );
    process.exit(1);
  } finally {
    await ccPrisma.$disconnect();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
