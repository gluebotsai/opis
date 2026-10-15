import type { FastifyInstance } from "fastify";
import { INTERNAL } from "../../helpers/constants.js";
import { postInternalOrgAppPushApiKeyHandler } from "../configuration/handler.js";

/** Service-to-service endpoints (x-internal-service-key). */
export default async function internalRoutes(server: FastifyInstance) {
  server.post(INTERNAL.ORG_API_KEYS, {
    schema: {
      tags: ["Internal"],
      summary:
        "Onboarding: mint org integration API key (app_push; x-internal-service-key)",
      body: {
        type: "object",
        required: ["organizationId"],
        properties: {
          organizationId: { type: "string" },
          purpose: { type: "string" },
        },
      },
    },
    handler: postInternalOrgAppPushApiKeyHandler,
  });
}
