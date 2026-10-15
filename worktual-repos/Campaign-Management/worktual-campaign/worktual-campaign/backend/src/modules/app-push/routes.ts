import type { FastifyInstance } from "fastify";
import { requireSession } from "../../middlewares/authendication.js";
import { validateAppPushAccess } from "../../middlewares/app-push-access.js";
import { AppError, sendSuccess } from "../../helpers/response-builders.js";
import {
  deactivatePushEndpointDao,
  listPushEndpointsWithContactsDao,
  registerAppPushDeviceDao,
} from "../../dao/push-endpoints.js";
import { readAppPushDeviceTokenFromBody } from "../../helpers/push-token.js";

/** App push: register device tokens + list endpoints. */
export default async function appPushRoutes(server: FastifyInstance) {
  server.addHook("preValidation", validateAppPushAccess);

  server.get("/endpoints", async (request, reply) => {
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
      channel: "push",
      contactIds: contactId ? [contactId] : undefined,
      activeOnly,
    });
    return sendSuccess(reply, "App push endpoints", {
      endpoints: rows,
      count: rows.length,
      integration: {
        register: "POST /api/app-push/endpoints",
        deactivate: "DELETE /api/app-push/endpoints/:id",
        auth:
          "Company backend: X-Api-Key: <org key> (mint via onboarding). Campaign UI / manual test: Authorization: Bearer <JWT>.",
        body_example: {
          endpoint: "<FCM_or_APNs — same value as app pushNotificationId>",
          pushNotificationId: "<optional alias for endpoint>",
          platform: "android",
          email: "user@example.com",
          phone: "+9198xxxxxxxx",
          contactId: "optional if contact already exists",
        },
        note:
          "Send email and/or phone when contactId is omitted. Do not send deviceId or socketId.",
      },
    });
  });

  server.post("/endpoints", async (request, reply) => {
    const session = requireSession(request);
    const body =
      typeof request.body === "object" && request.body
        ? (request.body as Record<string, unknown>)
        : {};
    const endpoint = readAppPushDeviceTokenFromBody(body);
    if (!endpoint) {
      throw new AppError(
        "endpoint (device token / pushNotificationId) is required.",
        400,
      );
    }
    const contactIdRaw =
      typeof body.contact_id === "string"
        ? body.contact_id
        : typeof body.contactId === "string"
          ? body.contactId
          : "";
    const email =
      typeof body.email === "string" ? body.email.trim() : "";
    const phone =
      typeof body.phone === "string"
        ? body.phone.trim()
        : typeof body.mobile === "string"
          ? body.mobile.trim()
          : "";
    if (!contactIdRaw.trim() && !email && !phone) {
      throw new AppError(
        "Provide email and/or phone to identify the contact.",
        400,
      );
    }

    const result = await registerAppPushDeviceDao(session, {
      endpoint,
      contactId:
        typeof body.contact_id === "string"
          ? body.contact_id
          : typeof body.contactId === "string"
            ? body.contactId
            : null,
      email: typeof body.email === "string" ? body.email : null,
      phone:
        typeof body.phone === "string"
          ? body.phone
          : typeof body.mobile === "string"
            ? body.mobile
            : null,
      firstName:
        typeof body.firstName === "string"
          ? body.firstName
          : typeof body.first_name === "string"
            ? body.first_name
            : null,
      lastName:
        typeof body.lastName === "string"
          ? body.lastName
          : typeof body.last_name === "string"
            ? body.last_name
            : null,
      platform:
        typeof body.platform === "string" ? body.platform : "android",
      label: typeof body.label === "string" ? body.label : null,
      active: body.active !== false,
    });

    return sendSuccess(reply, "App push endpoint saved", result, 200);
  });

  server.delete<{ Params: { id: string } }>(
    "/endpoints/:id",
    async (request, reply) => {
      const session = requireSession(request);
      const id = String(request.params.id || "").trim();
      if (!id) throw new AppError("endpoint id is required.", 400);
      const result = await deactivatePushEndpointDao(session, id);
      return sendSuccess(reply, "App push endpoint deactivated", result);
    },
  );
}
