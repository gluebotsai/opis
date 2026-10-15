import { entityIdSchema } from "@ai-contact-center/event-contracts";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { Logger } from "pino";

import type { ChatServiceConfig } from "../config.js";
import { EmailSender } from "../email/email-sender.js";
import { GmailCredentialStore } from "../email/credential-store.js";
import { isAuthorized } from "../lib/internal-auth.js";

const sendEmailSchema = z.object({
  organizationId: entityIdSchema,
  connectionId: entityIdSchema.optional(),
  to: z.string().email(),
  subject: z.string().min(1).max(512),
  body: z.string().min(1),
  threadId: z.string().min(1).optional(),
  inReplyTo: z.string().optional().nullable(),
  references: z.string().optional().nullable(),
  source: z.string().max(64).optional(),
  metadata: z.record(z.unknown()).optional(),
});

export function registerEmailSendRoute(
  app: FastifyInstance,
  config: ChatServiceConfig,
  logger: Logger,
): void {
  if (!config.tokenEncryptionKey) {
    logger.warn("email send route disabled (missing MS_TOKEN_ENCRYPTION_KEY)");
    return;
  }

  const credentials = new GmailCredentialStore(config);
  const sender = new EmailSender();

  app.post("/internal/v1/email/send", async (request, reply) => {
    if (!isAuthorized(request)) {
      return reply.status(401).send({ error: "Unauthorized" });
    }

    const payload = sendEmailSchema.parse(request.body);
    const runtime = payload.connectionId
      ? await credentials.getByConnectionId(payload.connectionId)
      : await credentials.getByOrganizationId(payload.organizationId);
    if (!runtime || runtime.organizationId !== payload.organizationId) {
      return reply.status(404).send({ error: "No connected Gmail account for organization" });
    }

    const result = await sender.send({
      credentials: runtime,
      to: payload.to,
      subject: payload.subject,
      body: payload.body,
      threadId: payload.threadId,
      inReplyTo: payload.inReplyTo,
      references: payload.references,
    });

    logger.info(
      {
        organizationId: payload.organizationId,
        providerMessageId: result.providerMessageId,
        source: payload.source ?? "internal",
        threadId: result.threadId,
      },
      "email sent via internal send API",
    );

    return {
      sent: true,
      organizationId: payload.organizationId,
      providerMessageId: result.providerMessageId,
      threadId: result.threadId,
      fromEmail: runtime.accountEmail,
    };
  });
}
