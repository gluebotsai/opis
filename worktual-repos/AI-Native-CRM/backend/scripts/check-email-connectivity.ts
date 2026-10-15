/**
 * Check OAuth email connectivity for sales reps + CRM bot.
 *   npx tsx --tsconfig tsconfig.json --env-file=../.env scripts/check-email-connectivity.ts
 */
import { prisma } from "../src/dao/db/prisma.js";
import { getCalendarConnection } from "../src/dao/calendar/token-repository";
import { resolveEmailSendProvider } from "../src/service/email/send-connected-email";
import { googleHasGmailSendScope } from "../src/service/google/access-token";
import { resolveCrmBotMailbox } from "../src/dao/account/crm-bot-mailbox";
import { sendCrmBotEmail } from "../src/service/email/send-crm-bot-email";
import { sendConnectedEmailForUser } from "../src/service/email/send-connected-email";

const ORG_ID = "1000";
const OWNER_USER_ID = process.env.SMOKE_OWNER_USER_ID || "1006";
const CUSTOMER_EMAIL = process.env.SMOKE_CUSTOMER_EMAIL || "sample151102@gmail.com";
const LIVE = process.argv.includes("--live");

async function checkUser(userId: string) {
  const google = await getCalendarConnection(userId, "google");
  const ms = await getCalendarConnection(userId, "microsoft");
  const provider = await resolveEmailSendProvider(userId, null);
  return {
    userId,
    google: google
      ? {
          email: google.accountEmail,
          canSend: googleHasGmailSendScope(google.scope),
          updatedAt: google.updatedAt?.toISOString?.() ?? null,
        }
      : null,
    microsoft: ms ? { email: ms.accountEmail } : null,
    resolvedProvider: provider,
    canSendCustomerMail: Boolean(provider),
  };
}

async function main() {
  console.log("=== Email connectivity check ===\n");

  for (const userId of ["1000", "1006"]) {
    console.log(JSON.stringify(await checkUser(userId), null, 2));
  }

  const bot = await resolveCrmBotMailbox(ORG_ID);
  console.log(
    "\nCRM bot:",
    JSON.stringify(
      bot
        ? {
            senderEmail: bot.senderEmail,
            accountEmail: bot.accountEmail,
            provider: bot.oauthProvider,
            needsReauth: bot.needsReauth,
            hasOAuth: Boolean(bot.oauthConnectionId),
            hasEncryptedToken: Boolean(bot.accessTokenEncrypted),
          }
        : null,
      null,
      2,
    ),
  );

  const encKey = process.env.MS_TOKEN_ENCRYPTION_KEY || process.env.ACCOUNTS_TOKEN_ENCRYPTION_KEY;
  console.log("\nMS_TOKEN_ENCRYPTION_KEY set:", Boolean(encKey));

  if (!LIVE) {
    console.log("\nPass --live to send test emails (prefixed [CRM TEST]).");
    return;
  }

  console.log("\n=== Live send tests ===");

  const ownerSend = await sendConnectedEmailForUser({
    userId: OWNER_USER_ID,
    to: CUSTOMER_EMAIL,
    subject: "[CRM TEST] Customer mail via rep inbox",
    body: "Smoke test — customer-facing email from assigned rep connected inbox.",
  });
  console.log("Rep → customer:", ownerSend);

  const botSend = await sendCrmBotEmail({
    organizationId: ORG_ID,
    to: "lucifer543666@gmail.com",
    subject: "[CRM TEST] Internal mail via CRM bot",
    body: "Smoke test — sales/internal notification email via CRM bot mailbox.",
  });
  console.log("CRM bot → owner:", botSend);
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
