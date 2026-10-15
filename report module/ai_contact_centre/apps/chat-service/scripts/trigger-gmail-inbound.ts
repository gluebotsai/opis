/**
 * Trigger GmailInboundProcessor for sample151102@gmail.com (live read path).
 */
import "@ai-contact-center/config/load-root-env";
import pino from "pino";
import { loadConfig } from "../src/config.js";
import { GmailCredentialStore } from "../src/email/credential-store.js";
import { GmailInboundProcessor } from "../src/email/inbound-processor.js";

const MAILBOX = "sample151102@gmail.com";

const config = loadConfig();
const logger = pino({ level: "info" });
const store = new GmailCredentialStore(config);
const processor = new GmailInboundProcessor(store, logger);

const credentials = await store.getByAccountEmail(MAILBOX);
if (!credentials) {
  console.error("No credentials for", MAILBOX);
  process.exit(1);
}

console.log(
  JSON.stringify(
    {
      step: "credentials",
      organizationId: credentials.organizationId,
      channelConfigId: credentials.connectionId,
    },
    null,
    2,
  ),
);

const accepted = await processor.processNotification({
  emailAddress: MAILBOX,
  historyId: null,
});

console.log(
  JSON.stringify(
    {
      step: "inbound-processor",
      mailbox: MAILBOX,
      accepted,
      organizationId: credentials.organizationId,
    },
    null,
    2,
  ),
);
