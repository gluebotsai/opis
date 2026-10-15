import type { FastifyInstance } from "fastify";
import {
  requireSession,
  validateSession,
} from "../../middlewares/authendication.js";
import { AppError, sendSuccess } from "../../helpers/response-builders.js";
import {
  deactivatePushEndpointDao,
  listPushEndpointsWithContactsDao,
  registerWebPushSubscriptionDao,
} from "../../dao/push-endpoints.js";
import { parseWebPushSubscribeBody } from "./parse-subscription.js";

/** Web push: register browser subscriptions + list endpoints. */
export default async function webPushRoutes(server: FastifyInstance) {
  server.addHook("preValidation", validateSession);

  server.get("/subscriptions", async (request, reply) => {
    const session = requireSession(request);
    const q =
      typeof request.query === "object" && request.query
        ? (request.query as Record<string, unknown>)
        : {};
    const contactId =
      typeof q.contactId === "string"
        ? q.contactId
        : typeof q.contact_id === "string"
          ? q.contact_id
          : null;
    const activeOnly =
      String(q.activeOnly ?? q.active_only ?? "true") !== "false";
    const rows = await listPushEndpointsWithContactsDao(session, {
      channel: "web",
      contactIds: contactId ? [contactId] : undefined,
      activeOnly,
    });
    return sendSuccess(reply, "Web push subscriptions", {
      subscriptions: rows,
      count: rows.length,
      integration: {
        register: "POST /api/web-push/subscriptions",
        deactivate: "DELETE /api/web-push/subscriptions/:id",
        body_example: {
          endpoint: "<PushSubscription.endpoint URL>",
          keys: { p256dh: "<base64>", auth: "<base64>" },
          platform: "browser",
          email: "user@example.com",
          contactId: "optional-if-you-already-have-it",
          // also accepted: { subscription: PushSubscription.toJSON(), email }
        },
        note: "Customer site: GET/POST /api/public/web-push without a staff JWT (site key + Origin). Authenticated POST remains for Configuration tests.",
      },
    });
  });

  server.post("/subscriptions", async (request, reply) => {
    const session = requireSession(request);
    const body =
      typeof request.body === "object" && request.body
        ? (request.body as Record<string, unknown>)
        : {};
    const parsed = parseWebPushSubscribeBody(body);
    const result = await registerWebPushSubscriptionDao(session, {
      endpoint: parsed.endpoint,
      keys: parsed.keys,
      contactId: parsed.contactId,
      email: parsed.email,
      phone: parsed.phone,
      firstName: parsed.firstName,
      lastName: parsed.lastName,
      platform: parsed.platform,
      label: parsed.label,
      active: parsed.active,
    });

    return sendSuccess(reply, "Web push subscription saved", result, 200);
  });

  server.delete<{ Params: { id: string } }>(
    "/subscriptions/:id",
    async (request, reply) => {
      const session = requireSession(request);
      const id = String(request.params.id || "").trim();
      if (!id) throw new AppError("subscription id is required.", 400);
      const result = await deactivatePushEndpointDao(session, id);
      return sendSuccess(reply, "Web push subscription deactivated", result);
    },
  );
}
