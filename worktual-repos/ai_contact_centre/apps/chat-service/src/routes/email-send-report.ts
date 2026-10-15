import { entityIdSchema } from "@ai-contact-center/event-contracts";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { Logger } from "pino";

import type { ChatServiceConfig } from "../config.js";
import { EmailSender } from "../email/email-sender.js";
import { GmailCredentialStore } from "../email/credential-store.js";
import { isAuthorized } from "../lib/internal-auth.js";

const sendReportSchema = z.object({
  organizationId: entityIdSchema,
  channelConfigId: entityIdSchema,
  fromEmail: z.string().email(),
  fromName: z.string().max(255).optional().nullable(),
  replyTo: z.string().email().optional().nullable(),
  toEmail: z.string().email(),
  subject: z.string().min(1).max(512),
  body: z.string().min(1),
  fileName: z.string().min(1).max(255),
  pdfBase64: z.string().min(1),
});

export function registerEmailSendReportRoute(
  app: FastifyInstance,
  config: ChatServiceConfig,
  logger: Logger,
): void {
  if (!config.tokenEncryptionKey) {
    logger.warn("email send-report route disabled (missing MS_TOKEN_ENCRYPTION_KEY)");
    return;
  }

  const credentials = new GmailCredentialStore(config);
  const sender = new EmailSender();

  // Dashboard PDF attachments are sent as base64 JSON and can exceed Fastify's 1 MiB default.
  const reportEmailBodyLimitBytes = 32 * 1024 * 1024;

  app.post(
    "/internal/v1/email/send-report",
    { bodyLimit: reportEmailBodyLimitBytes },
    async (request, reply) => {
      if (!isAuthorized(request)) {
        return reply.status(401).send({ error: "Unauthorized" });
      }

      const payload = sendReportSchema.parse(request.body);
      const runtime = await credentials.getByConnectionId(payload.channelConfigId);
      if (!runtime || runtime.organizationId !== payload.organizationId) {
        return reply.status(404).send({
          error: "No connected mailbox for channel",
          message: "internal_report_mailbox_not_configured",
        });
      }

      if (runtime.ccaasHandler?.trim().toLowerCase() !== "internal") {
        return reply.status(403).send({
          error: "Mailbox is not configured for internal report delivery",
          message: "internal_report_mailbox_invalid",
        });
      }

      const result = await sender.send({
        credentials: runtime,
        to: payload.toEmail,
        subject: payload.subject,
        body: payload.body,
        attachment: {
          fileName: payload.fileName,
          mimeType: "application/pdf",
          contentBase64: payload.pdfBase64,
        },
      });

      logger.info(
        {
          organizationId: payload.organizationId,
          channelConfigId: payload.channelConfigId,
          toEmail: payload.toEmail,
          providerMessageId: result.providerMessageId,
        },
        "scheduled report email sent",
      );

      return {
        sent: true,
        organizationId: payload.organizationId,
        providerMessageId: result.providerMessageId,
        fromEmail: payload.fromEmail,
      };
    },
  );
}
