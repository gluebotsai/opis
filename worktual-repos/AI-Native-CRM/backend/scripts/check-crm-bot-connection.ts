/**
 * Verify CRM bot token decrypt + refresh status.
 *   npx tsx --tsconfig tsconfig.json --env-file=../.env scripts/check-crm-bot-connection.ts
 */
import { resolveCrmBotMailbox } from "../src/dao/account/crm-bot-mailbox";
import {
  decryptAccountsSecret,
  accountsTokenEncryptionConfigured,
} from "../src/service/account/accounts-token-crypto";
import { getValidOauthAccessToken } from "../src/service/email/send-crm-bot-email";
import { sendCrmBotEmail } from "../src/service/email/send-crm-bot-email";
import { prisma } from "../src/dao/db/prisma.js";

const ORG_ID = "1000";
const LIVE = process.argv.includes("--live");

async function main() {
  console.log("MS_TOKEN_ENCRYPTION_KEY configured:", accountsTokenEncryptionConfigured());

  const mailbox = await resolveCrmBotMailbox(ORG_ID);
  if (!mailbox) {
    console.log("FAIL: CRM bot mailbox not found for org", ORG_ID);
    process.exit(1);
  }

  console.log("\nMailbox:");
  console.log({
    accountEmail: mailbox.accountEmail,
    senderEmail: mailbox.senderEmail,
    provider: mailbox.oauthProvider,
    needsReauth: mailbox.needsReauth,
    oauthConnectionId: mailbox.oauthConnectionId,
    tokenExpiresAt: mailbox.tokenExpiresAt?.toISOString?.() ?? null,
    hasAccessToken: Boolean(mailbox.accessTokenEncrypted),
    hasRefreshToken: Boolean(mailbox.refreshTokenEncrypted),
  });

  let decryptOk = false;
  try {
    const access = decryptAccountsSecret(mailbox.accessTokenEncrypted!);
    decryptOk = access.length > 10;
    console.log("\nToken decrypt: OK (access token length", access.length, ")");
  } catch (err) {
    console.log("\nToken decrypt: FAIL —", err instanceof Error ? err.message : err);
  }

  const token = await getValidOauthAccessToken(mailbox);
  console.log("\ngetValidOauthAccessToken:", token.ok ? "OK" : token);

  if (LIVE && token.ok) {
    const sent = await sendCrmBotEmail({
      organizationId: ORG_ID,
      to: "lucifer543666@gmail.com",
      subject: "[CRM TEST] CRM bot connection verified",
      body: "If you receive this, MS_TOKEN_ENCRYPTION_KEY + CRM bot OAuth are working.",
    });
    console.log("\nLive send:", sent);
  } else if (LIVE) {
    console.log("\nSkipping live send — token not valid.");
  } else {
    console.log("\nPass --live to attempt a test send after token refresh.");
  }

  process.exit(decryptOk && token.ok ? 0 : 1);
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
