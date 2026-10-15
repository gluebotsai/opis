import type { FastifyInstance } from "fastify";
import type { Logger } from "pino";
import { getWebhookPaths } from "@ai-contact-center/api-paths";

import type { MetaMessengerAppConfig } from "../config.js";
import type { MetaMessengerClient } from "../providers/meta-messenger.js";
import type { MessengerCredentialManager } from "../services/messenger-credential-manager.js";
import { handleMetaMessengerWebhook } from "../services/messenger-inbound-handler.js";
import type {
  MetaMessengerWebhookPayload,
  MetaMessengerWebhookVerificationQuery,
} from "../types/meta-messenger.js";

export function registerMessengerWebhookRoutes(
  app: FastifyInstance,
  config: MetaMessengerAppConfig,
  client: MetaMessengerClient,
  credentials: MessengerCredentialManager | null,
  loggers: {
    facebook: Logger;
    instagram: Logger;
  },
): void {
  registerChannelWebhook(app, {
    channelType: "facebook",
    verifyToken: config.facebookVerifyToken,
    config,
    client,
    credentials,
    logger: loggers.facebook,
    messagesLogger: loggers.facebook,
  });
  registerChannelWebhook(app, {
    channelType: "instagram",
    verifyToken: config.instagramVerifyToken,
    config,
    client,
    credentials,
    logger: loggers.instagram,
    messagesLogger: loggers.instagram,
  });
}

function registerChannelWebhook(
  app: FastifyInstance,
  input: {
    channelType: "facebook" | "instagram";
    verifyToken: string;
    config: MetaMessengerAppConfig;
    client: MetaMessengerClient;
    credentials: MessengerCredentialManager | null;
    logger: Logger;
    messagesLogger?: Logger;
  },
): void {
  for (const webhookPath of getWebhookPaths(input.channelType)) {
    app.register(async (scoped) => {
      scoped.addContentTypeParser(
        "application/json",
        { parseAs: "buffer" },
        (_request, body, done) => {
          done(null, body);
        },
      );

      scoped.get(webhookPath, async (request, reply) => {
        const query = request.query as MetaMessengerWebhookVerificationQuery;
        const mode = query["hub.mode"];
        const token = query["hub.verify_token"];
        const challenge = query["hub.challenge"];

        if (mode === "subscribe" && token === input.verifyToken && challenge) {
          input.logger.info({ webhookPath, channelType: input.channelType }, "messenger webhook verified");
          return reply.status(200).type("text/plain").send(challenge);
        }

        input.logger.warn(
          {
            mode,
            tokenProvided: Boolean(token),
            webhookPath,
            channelType: input.channelType,
          },
          "messenger webhook verification failed",
        );
        return reply.status(403).send({ error: "Verification failed" });
      });

      scoped.post(webhookPath, async (request, reply) => {
        const channelAppSecret = input.client.appSecretForChannel(input.channelType);
        if (!channelAppSecret || !input.credentials) {
          return reply.status(503).send({
            error: {
              code: "messenger_not_configured",
              message: "Messenger runtime credentials are not configured",
              retryable: false,
            },
          });
        }

        const rawBody = request.body as Buffer;
        const signature = request.headers["x-hub-signature-256"];
        const signatureValue = Array.isArray(signature) ? signature[0] : signature;

        if (!input.client.verifyWebhookSignature(signatureValue, rawBody, channelAppSecret)) {
          input.logger.warn(
            { webhookPath, channelType: input.channelType },
            "messenger webhook signature verification failed",
          );
          return reply.status(401).send({ error: "Invalid signature" });
        }

        let payload: MetaMessengerWebhookPayload;
        try {
          payload = JSON.parse(rawBody.toString("utf8")) as MetaMessengerWebhookPayload;
        } catch {
          input.logger.warn(
            { webhookPath, channelType: input.channelType },
            "messenger webhook received invalid JSON",
          );
          return reply.status(400).send({ error: "Invalid JSON payload" });
        }

        input.logger.info(
          {
            object: payload.object,
            entryCount: payload.entry?.length ?? 0,
            channelType: input.channelType,
            webhookPath,
            // Full Meta callback body for Instagram/Facebook debugging.
            metaPayload: payload,
            rawBody: rawBody.toString("utf8"),
          },
          "messenger webhook received",
        );

        const result = await handleMetaMessengerWebhook(payload, {
          channelType: input.channelType,
          credentials: input.credentials,
          client: input.client,
          logger: input.logger,
          messagesLogger: input.messagesLogger,
          autoReply: input.config.autoReply,
          autoReplyMessage: input.config.autoReplyMessage,
          autoReplyButtons: input.config.autoReplyButtons,
          autoReplyButtonBody: input.config.autoReplyButtonBody,
          autoReplyButtonList: input.config.autoReplyButtonList,
        });

        input.logger.info(
          {
            channelType: input.channelType,
            webhookPath,
            inboundMessages: result.accepted,
            unresolvedChanges: result.unresolved,
            repliesSent: result.repliesSent,
            buttonRepliesSent: result.buttonRepliesSent,
          },
          "messenger webhook processing completed",
        );

        return {
          accepted: true,
          channelType: input.channelType,
          inboundMessages: result.accepted,
          unresolvedChanges: result.unresolved,
          repliesSent: result.repliesSent,
          buttonRepliesSent: result.buttonRepliesSent,
        };
      });
    });
  }
}
