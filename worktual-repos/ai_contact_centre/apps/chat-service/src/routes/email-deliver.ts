import { entityIdSchema } from "@ai-contact-center/event-contracts";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { Logger } from "pino";

import type { ChatServiceConfig } from "../config.js";
import { EmailSender } from "../email/email-sender.js";
import { GmailCredentialStore } from "../email/credential-store.js";
import { isAuthorized } from "../lib/internal-auth.js";
import { updateEmailDelivery } from "../services/cc-core-email-client.js";

const deliverSchema = z.object({
  organizationId: entityIdSchema,
  conversationId: entityIdSchema,
  messageId: entityIdSchema,
  deliveryId: entityIdSchema,
  connectionId: entityIdSchema,
  body: z.string().min(1),
  threadId: z.string().min(1),
  subject: z.string().min(1),
  recipientEmail: z.string().email(),
  inReplyTo: z.string().optional().nullable(),
  references: z.string().optional().nullable(),
});

export function registerEmailDeliverRoute(
  app: FastifyInstance,
  config: ChatServiceConfig,
  logger: Logger,
): void {
  if (!config.tokenEncryptionKey) {
    logger.warn("email deliver route disabled (missing MS_TOKEN_ENCRYPTION_KEY)");
    return;
  }

  const credentials = new GmailCredentialStore(config);
  const sender = new EmailSender();

  app.post("/internal/v1/email/deliver", async (request, reply) => {
    if (!isAuthorized(request)) {
      return reply.status(401).send({ error: "Unauthorized" });
    }

    const payload = deliverSchema.parse(request.body);
    const runtime = await credentials.getByConnectionId(payload.connectionId);
    if (!runtime || runtime.organizationId !== payload.organizationId) {
      await updateEmailDelivery(payload.organizationId, payload.deliveryId, {
        status: "failed",
        error: "Configured Gmail connection is unavailable or belongs to another tenant",
      });
      return reply.status(404).send({ error: "Configured Gmail connection is unavailable" });
    }

    let result: Awaited<ReturnType<EmailSender["send"]>>;
    try {
      result = await sender.send({
        credentials: runtime,
        to: payload.recipientEmail,
        subject: payload.subject,
        body: payload.body,
        threadId: payload.threadId,
        inReplyTo: payload.inReplyTo,
        references: payload.references,
      });
      await updateEmailDelivery(payload.organizationId, payload.deliveryId, {
        status: "sent",
        providerMessageId: result.providerMessageId,
        providerRfcMessageId: result.rfcMessageId,
      });
    } catch (error) {
      await updateEmailDelivery(payload.organizationId, payload.deliveryId, {
        status: "retry",
        error: error instanceof Error ? error.message : "Gmail delivery failed",
        retryAfterSeconds: 30,
      });
      return reply.status(502).send({ error: "Gmail delivery failed; queued for retry" });
    }

    logger.info(
      {
        organizationId: payload.organizationId,
        conversationId: payload.conversationId,
        messageId: payload.messageId,
        providerMessageId: result.providerMessageId,
      },
      "email message delivered",
    );

    return {
      delivered: true,
      conversationId: payload.conversationId,
      messageId: payload.messageId,
      providerMessageId: result.providerMessageId,
    };
  });
}
