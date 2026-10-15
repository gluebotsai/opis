import type { FastifyPluginAsync } from "fastify";
import {
  processRazorpayWebhook,
  processStripeWebhook,
} from "@/service/finance/payment-gateways/index.js";

export const paymentGatewayWebhookRoutes: FastifyPluginAsync = async (app) => {
  app.addContentTypeParser(
    "application/json",
    { parseAs: "string" },
    (_req, body, done) => {
      done(null, body);
    },
  );

  app.post<{ Params: { organizationId: string } }>(
    "/stripe/:organizationId",
    async (request, reply) => {
      const rawBody =
        typeof request.body === "string" ? request.body : JSON.stringify(request.body ?? {});
      const signature = request.headers["stripe-signature"];
      const sig = Array.isArray(signature) ? signature[0] : signature;
      const result = await processStripeWebhook(
        rawBody,
        sig,
        request.params.organizationId,
      );
      if (!result.ok) {
        const code = result.statusCode ?? 400;
        if (code === 200) return reply.send({ ok: true, ignored: true });
        return reply.status(code).send({ error: result.error });
      }
      return reply.send({ ok: true });
    },
  );

  app.post<{ Params: { organizationId: string } }>(
    "/razorpay/:organizationId",
    async (request, reply) => {
      const rawBody =
        typeof request.body === "string" ? request.body : JSON.stringify(request.body ?? {});
      const signature = request.headers["x-razorpay-signature"];
      const sig = Array.isArray(signature) ? signature[0] : signature;
      const result = await processRazorpayWebhook(
        rawBody,
        sig,
        request.params.organizationId,
      );
      if (!result.ok) {
        const code = result.statusCode ?? 400;
        if (code === 200) return reply.send({ ok: true, ignored: true });
        return reply.status(code).send({ error: result.error });
      }
      return reply.send({ ok: true });
    },
  );
};
