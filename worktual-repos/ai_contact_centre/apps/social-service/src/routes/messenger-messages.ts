import { entityIdSchema } from "@ai-contact-center/event-contracts";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { Logger } from "pino";

import { isInternalRequestAuthorized } from "../lib/internal-auth.js";
import { mapServiceError } from "../lib/route-errors.js";
import type { MetaMessengerClient } from "../providers/meta-messenger.js";
import type { MessengerCredentialManager } from "../services/messenger-credential-manager.js";

const sendTextSchema = z.object({
  channelConfigId: entityIdSchema,
  to: z.string().min(1),
  body: z.string().min(1).max(2000),
});

function unauthorized(reply: { status: (code: number) => { send: (body: unknown) => unknown } }) {
  return reply.status(401).send({
    error: {
      code: "unauthorized",
      message: "Unauthorized",
      retryable: false,
    },
  });
}

export function registerMessengerMessageRoutes(
  app: FastifyInstance,
  client: MetaMessengerClient,
  credentials: MessengerCredentialManager,
  internalServiceKey: string | null,
  loggers: {
    facebook: Logger;
    instagram: Logger;
  },
): void {
  for (const channel of ["facebook", "instagram"] as const) {
    app.post(`/internal/v1/${channel}/messages`, async (request, reply) => {
      const logger = loggers[channel];
      if (!isInternalRequestAuthorized(request, internalServiceKey)) {
        logger.warn({ channel }, "unauthorized messenger send request");
        return unauthorized(reply);
      }

      try {
        const payload = sendTextSchema.parse(request.body);
        const result = await credentials.executeByChannel(
          payload.channelConfigId,
          channel,
          (runtimeCredentials) =>
            client.sendTextMessage(runtimeCredentials, payload.to, payload.body),
        );

        logger.info(
          {
            channelConfigId: payload.channelConfigId,
            channel,
            messageId: result.message_id ?? null,
          },
          "messenger text message sent",
        );

        return {
          sent: true,
          providerMessageId: result.message_id ?? null,
          channelConfigId: payload.channelConfigId,
          channel,
        };
      } catch (error) {
        logger.error({ err: error, channel }, "failed to send messenger text message");
        return mapServiceError(reply, error);
      }
    });
  }
}
