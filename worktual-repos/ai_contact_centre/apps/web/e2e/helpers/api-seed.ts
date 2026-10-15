import {
  CcCoreClient,
  createTestRunIds,
  loadE2eConfig,
  runPreflight,
  SocialClient,
} from "@ai-contact-center/test-harness";
import { randomUUID } from "node:crypto";

export type ApiSeedResult = {
  organizationId: string;
  webchatId?: string;
  contactId?: string;
  emailConversationId?: string;
  whatsappFrom?: string;
  sharedEmail: string;
};

export async function seedCrossChannelContact(): Promise<ApiSeedResult> {
  const preflight = await runPreflight({ requireStack: true });
  if (!preflight.ok || !preflight.organizationId) {
    throw new Error(`Preflight failed: ${preflight.errors.join("; ")}`);
  }

  const config = loadE2eConfig();
  const ccCore = new CcCoreClient(config);
  const social = new SocialClient(config);
  const ids = createTestRunIds("pw");
  const sharedEmail = ids.email;

  let emailConversationId: string | undefined;
  if (preflight.webchatId) {
    await ccCore.startWebchatConversation(preflight.organizationId, {
      webchatId: preflight.webchatId,
      visitorId: ids.visitorId,
      prechatAnswers: { email: sharedEmail, name: "Playwright Cross Channel" },
    });
  }

  if (preflight.whatsappPhoneNumberId) {
    await social.postWhatsAppWebhook(
      social.buildInboundWebhookPayload({
        phoneNumberId: preflight.whatsappPhoneNumberId,
        from: ids.phone.replace(/\D/g, ""),
        messageId: `wamid-${randomUUID()}`,
        body: `Follow-up via WhatsApp for ${sharedEmail}`,
      }),
    );
  }

  const session = await ccCore.loginAgent();
  const resolved = await ccCore.resolveContact(session, { email: sharedEmail });

  return {
    organizationId: preflight.organizationId,
    webchatId: preflight.webchatId,
    contactId: resolved.contactId,
    emailConversationId,
    whatsappFrom: ids.phone.replace(/\D/g, ""),
    sharedEmail,
  };
}

export async function seedEmailConversation() {
  const preflight = await runPreflight({ requireStack: true });
  if (!preflight.ok || !preflight.organizationId) {
    throw new Error(`Preflight failed: ${preflight.errors.join("; ")}`);
  }

  const config = loadE2eConfig();
  const ccCore = new CcCoreClient(config);
  const ids = createTestRunIds("pw-email");
  const msgId = randomUUID();

  const ingest = await ccCore.ingestEmail(preflight.organizationId, {
    organizationId: preflight.organizationId,
    externalThreadId: `pw-thread-${ids.runId}`,
    externalMessageId: msgId,
    customerEmail: ids.email,
    customerName: "Playwright Email Customer",
    subject: "Playwright seeded email",
    body: "This conversation was seeded for agent E2E.",
    occurredAt: new Date().toISOString(),
    rfcMessageId: `<${msgId}@example.com>`,
  });

  return {
    organizationId: preflight.organizationId,
    conversationId: ingest.conversation.id,
    customerEmail: ids.email,
  };
}
