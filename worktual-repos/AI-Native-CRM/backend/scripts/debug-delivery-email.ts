import { resolveSetupUserDeliveryEmail } from "../src/service/account/setup-users.js";
import { resolveCrmBotMailbox } from "../src/dao/account/crm-bot-mailbox.js";
import { prisma } from "../src/dao/db/prisma.js";

for (const userId of ["1000", "1006"]) {
  const delivery = await resolveSetupUserDeliveryEmail(userId, "1000");
  console.log(userId, delivery);
}
const bot = await resolveCrmBotMailbox("1000");
console.log(
  "crmBot",
  bot
    ? {
        senderEmail: bot.senderEmail,
        accountEmail: bot.accountEmail,
        provider: bot.oauthProvider,
        needsReauth: bot.needsReauth,
        hasOAuth: Boolean(bot.oauthConnectionId),
      }
    : null,
);

await prisma.$disconnect();
