import "@ai-contact-center/config/load-root-env";
import { ccPrisma } from "@ai-contact-center/db-cc";
import { loadConfig } from "../src/config.js";
import { GmailCredentialStore } from "../src/email/credential-store.js";
import { GmailClient } from "../src/email/gmail-client.js";

async function main() {
  const config = loadConfig();
  if (!config.gmailOAuth || !config.tokenEncryptionKey || !config.gmailPubSub) {
    console.error("Missing Gmail OAuth / encryption / pubsub config");
    process.exit(1);
  }

  const store = new GmailCredentialStore(config);
  const accountEmail = process.argv[2] ?? "sample151102@gmail.com";
  const runtime = await store.getByAccountEmail(accountEmail);
  if (!runtime) {
    console.error(
      `No active Setup email channel credentials for ${accountEmail}. ` +
        "Verify accounts.setup_channel_configs + setup_email_configs + mail_oauth_connections.",
    );
    process.exit(1);
  }

  const gmail = new GmailClient();
  const watch = await gmail.registerWatch(runtime, config.gmailPubSub.topic);
  console.log(
    JSON.stringify(
      {
        ok: true,
        accountEmail: runtime.accountEmail,
        organizationId: runtime.organizationId,
        channelConfigId: runtime.connectionId,
        oauthConnectionId: runtime.oauthConnectionId,
        ccaasHandler: runtime.ccaasHandler,
        tokenExpiresAt: runtime.tokenExpiresAt?.toISOString() ?? null,
        watch,
      },
      null,
      2,
    ),
  );
  await ccPrisma.$disconnect();
}

main().catch((error) => {
  console.error("verify failed:", error instanceof Error ? error.message : error);
  process.exit(1);
});
