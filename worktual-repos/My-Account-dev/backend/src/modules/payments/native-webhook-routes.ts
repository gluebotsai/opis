import type { FastifyPluginAsync, FastifyRequest } from "fastify";

import { logPaymentError } from "../../infra/file-logger.js";
import { handleRazorpayWebhookRequest } from "./razorpayWebhook.js";
import { handleStripeWebhookRequest } from "./stripeWebhook.js";
import { rawBodyRouteConfig } from "../../plugins/http.js";

type WebhookProvider = "stripe" | "razorpay";

function signatureHeader(
  provider: WebhookProvider,
  request: FastifyRequest,
): string | string[] | undefined {
  const name =
    provider === "stripe" ? "stripe-signature" : "x-razorpay-signature";
  return request.raw.headers[name];
}

export const nativePaymentWebhookRoutes: FastifyPluginAsync = async (app) => {
  for (const provider of ["stripe", "razorpay"] as const) {
    app.post(
      `/api/payments/webhook/${provider}`,
      { config: rawBodyRouteConfig },
      async (request, reply) => {
        reply.header("x-route-host", "fastify");

        try {
          if (!Buffer.isBuffer(request.rawBody)) {
            throw new Error("Signed webhook body is required.");
          }

          const result =
            provider === "stripe"
              ? await handleStripeWebhookRequest(
                  request.rawBody,
                  signatureHeader(provider, request),
                )
              : await handleRazorpayWebhookRequest(
                  request.rawBody,
                  signatureHeader(provider, request),
                );

          return reply.send({ received: true, ...result });
        } catch (error) {
          logPaymentError(`${provider}.webhook.failed`, error);
          return reply.status(400).send({
            error:
              error instanceof Error
                ? error.message
                : `${provider === "stripe" ? "Stripe" : "Razorpay"} webhook failed.`,
          });
        }
      },
    );
  }
};
