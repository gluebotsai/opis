import type { FastifyInstance } from "fastify";
import { AUTH } from "../../helpers/constants.js";
import { validateSession } from "../../middlewares/authendication.js";
import {
  loginHandler,
  logoutHandler,
  meHandler,
  onboardingDashboardLinkHandler,
  onboardingExchangeHandler,
} from "./handler.js";
import { authSchemas } from "./schema.js";

export default async function authRoutes(server: FastifyInstance) {
  server.post(AUTH.LOGIN, {
    schema: {
      tags: ["Auth"],
      summary: "Login against my_account_qa with campaign entitlement",
      body: authSchemas.loginBody,
    },
    handler: loginHandler,
  });

  server.get(AUTH.ME, {
    schema: { tags: ["Auth"], summary: "Current session user" },
    preValidation: [validateSession],
    handler: meHandler,
  });

  server.post(AUTH.LOGOUT, {
    schema: { tags: ["Auth"], summary: "Sign out Campaign only (product_id=campaign)" },
    preValidation: [validateSession],
    handler: logoutHandler,
  });

  server.post(AUTH.ONBOARDING_DASHBOARD_LINK, {
    schema: {
      tags: ["Auth"],
      summary:
        "Onboarding team: mint one-time dashboard deep-link (x-internal-service-key)",
      body: authSchemas.onboardingDashboardLinkBody,
    },
    handler: onboardingDashboardLinkHandler,
  });

  server.post(AUTH.ONBOARDING_EXCHANGE, {
    schema: {
      tags: ["Auth"],
      summary: "Exchange one-time onboarding code for Campaign JWT",
      body: authSchemas.onboardingExchangeBody,
    },
    handler: onboardingExchangeHandler,
  });
}
