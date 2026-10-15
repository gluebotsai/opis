import type { FastifyInstance } from "fastify";
import type { Logger } from "pino";
import { getWebhookPaths } from "@ai-contact-center/api-paths";

import type { MetaWhatsAppAppConfig } from "../config.js";
import type { MetaWhatsAppClient } from "../providers/meta-whatsapp.js";
import { handleMetaWhatsAppWebhook } from "../services/inbound-handler.js";
import type { WhatsAppCredentialManager } from "../services/credential-manager.js";
import type {
  MetaWebhookPayload,
  MetaWebhookVerificationQuery,
} from "../types/meta-whatsapp.js";

export function registerWhatsAppWebhookRoutes(
  app: FastifyInstance,
  config: MetaWhatsAppAppConfig,
  client: MetaWhatsAppClient,
  credentials: WhatsAppCredentialManager | null,
  logger: Logger,
  messagesLogger?: Logger,
): void {
  for (const webhookPath of getWebhookPaths()) {
    app.register(async (scoped) => {
      scoped.addContentTypeParser(
        "application/json",
        { parseAs: "buffer" },
        (_request, body, done) => {
          done(null, body);
        },
      );

      scoped.get(webhookPath, async (request, reply) => {
        const query = request.query as MetaWebhookVerificationQuery;
        const mode = query["hub.mode"];
        const token = query["hub.verify_token"];
        const challenge = query["hub.challenge"];

        if (mode === "subscribe" && token === config.verifyToken && challenge) {
          logger.info({ webhookPath }, "whatsapp webhook verified");
          return reply.status(200).type("text/plain").send(challenge);
        }

        logger.warn({ mode, tokenProvided: Boolean(token), webhookPath }, "whatsapp webhook verification failed");
        return reply.status(403).send({ error: "Verification failed" });
      });

      scoped.post(webhookPath, async (request, reply) => {
        if (!config.appSecret || !credentials) {
          return reply.status(503).send({
            error: {
              code: "whatsapp_not_configured",
              message: "WhatsApp runtime credentials are not configured",
              retryable: false,
            },
          });
        }
        const rawBody = request.body as Buffer;
        const signature = request.headers["x-hub-signature-256"];
        const signatureValue = Array.isArray(signature) ? signature[0] : signature;

        if (!client.verifyWebhookSignature(signatureValue, rawBody)) {
          logger.warn({ webhookPath }, "whatsapp webhook signature verification failed");
          return reply.status(401).send({ error: "Invalid signature" });
        }

        let payload: MetaWebhookPayload;
        try {
          payload = JSON.parse(rawBody.toString("utf8")) as MetaWebhookPayload;
        } catch {
          logger.warn({ webhookPath }, "whatsapp webhook received invalid JSON");
          return reply.status(400).send({ error: "Invalid JSON payload" });
        }

        logger.info(
          {
            object: payload.object,
            entryCount: payload.entry?.length ?? 0,
            webhookPath,
          },
          "whatsapp webhook received",
        );

        const result = await handleMetaWhatsAppWebhook(payload, {
          credentials,
          client,
          logger,
          messagesLogger,
          markRead: config.markRead,
          autoReply: config.autoReply,
          autoReplyMessage: config.autoReplyMessage,
          autoReplyTemplate: config.autoReplyTemplate,
          autoReplyButtons: config.autoReplyButtons,
          autoReplyButtonBody: config.autoReplyButtonBody,
          autoReplyButtonList: config.autoReplyButtonList,
        });

        return {
          accepted: true,
          inboundMessages: result.accepted,
          statusUpdates: result.statuses,
          unresolvedChanges: result.unresolved,
          repliesSent: result.repliesSent,
          templateRepliesSent: result.templateRepliesSent,
          buttonRepliesSent: result.buttonRepliesSent,
        };
      });
    });
  }
}
