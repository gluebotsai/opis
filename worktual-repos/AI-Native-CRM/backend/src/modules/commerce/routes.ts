import type { FastifyPluginAsync } from "fastify";
import {
  createCommerceOrderCommand,
  getCommerceCreateOptionsCommand,
  getCommerceOrderCommand,
  listCommerceOrdersCommand,
} from "@/service/commerce/commerce-commands";
import { requireSessionOrApiKey, withUser } from "../../middlewares/auth.js";
import { sendSuccess, sendError, sendResult } from "../../helpers/response.js";

export const commerceRoutes: FastifyPluginAsync = async (app) => {
  app.get<{
    Querystring: { page?: string; contactId?: string };
  }>("/orders", async (request, reply) => {
    const userId = await requireSessionOrApiKey(request, reply, "commerce");
    if (!userId) return;
    return withUser(
      userId,
      async () => {
        const page = Math.max(1, Number(request.query.page) || 1);
        const result = await listCommerceOrdersCommand({
          page,
          contactId: request.query.contactId,
        });
        return sendSuccess(reply, result);
      },
      request,
    );
  });

  app.get("/orders/create-options", async (request, reply) => {
    const userId = await requireSessionOrApiKey(request, reply, "commerce");
    if (!userId) return;
    return withUser(
      userId,
      async () => {
        const result = await getCommerceCreateOptionsCommand();
        return sendSuccess(reply, result);
      },
      request,
    );
  });

  app.get<{ Params: { id: string } }>("/orders/:id", async (request, reply) => {
    const userId = await requireSessionOrApiKey(request, reply, "commerce");
    if (!userId) return;
    return withUser(
      userId,
      async () => {
        const result = await getCommerceOrderCommand(request.params.id);
        return sendResult(reply, result);
      },
      request,
    );
  });

  app.post<{
    Body: {
      contactId?: string;
      productId?: string;
      quantity?: number;
    };
  }>("/orders", async (request, reply) => {
    const userId = await requireSessionOrApiKey(request, reply, "commerce");
    if (!userId) return;
    return withUser(
      userId,
      async () => {
        const body = request.body ?? {};
        if (!body.contactId || !body.productId) {
          return sendError(reply, "contactId and productId are required.", 400);
        }
        const result = await createCommerceOrderCommand({
          contactId: body.contactId,
          productId: body.productId,
          quantity: body.quantity,
        });
        return sendResult(reply, result);
      },
      request,
    );
  });
};
