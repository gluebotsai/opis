import type { FastifyInstance } from "fastify";
import { joinApiV1 } from "@ai-contact-center/api-paths";
import { z } from "zod";

import { loginInputSchema, loginSetupUser } from "../services/auth.js";
import {
  exchangeOnboardingCode,
  exchangeOnboardingCodeSchema,
  mintOnboardingDashboardLink,
  mintOnboardingLinkSchema,
} from "../services/onboarding-dashboard.js";
import { revokeAuthSession } from "../services/auth-sessions.js";
import { registerSipOnLogin, unregisterSipOnLogout } from "../services/sip-registration.js";
import { hasValidInternalServiceKey } from "../middleware/internal-auth.js";
import { withOrganizationContext } from "../lib/rls.js";
import { updateAgentPresence } from "../services/presence.js";
import { releasePendingNonEmailOffersForAgent } from "../services/conversations.js";
import {
  emitConversationQueued,
  emitConversationRejected,
  emitConversationRouted,
  emitPresenceUpdated,
  emitTransferExpired,
  shouldScheduleOfferExpiration,
} from "../services/realtime.js";
import { cancelOfferExpiration, scheduleOfferExpiration } from "../services/offer-lifecycle.js";

function mapAuthRouteError(app: FastifyInstance, error: unknown, fallback: string): Error {
  if (error instanceof z.ZodError) {
    return app.httpErrors.badRequest(error.issues[0]?.message ?? "Invalid payload");
  }
  if (
    typeof error === "object" &&
    error &&
    "status" in error &&
    typeof (error as { status: unknown }).status === "number"
  ) {
    const status = (error as { status: number }).status;
    const message = error instanceof Error ? error.message : fallback;
    if (status === 401) return app.httpErrors.unauthorized(message);
    if (status === 404) return app.httpErrors.notFound(message);
    if (status === 409) return app.httpErrors.conflict(message);
  }
  if (error instanceof Error) return error;
  return app.httpErrors.internalServerError(fallback);
}

export async function registerAuthRoutes(
  app: FastifyInstance,
  apiV1Base: string,
): Promise<void> {
  app.post(joinApiV1(apiV1Base, "/auth/login"), async (request, reply) => {
    const secret = process.env.JWT_SECRET;
    if (!secret) {
      throw app.httpErrors.internalServerError("JWT_SECRET is not configured");
    }

    try {
      const input = loginInputSchema.parse(request.body);
      const result = await loginSetupUser(app.prisma, input, secret);
      try {
        await registerSipOnLogin(app.prisma, result.user.organizationId, result.user.id);
      } catch (error) {
        app.log.warn({ error, userId: result.user.id }, "sip registration on login failed");
      }
      return reply.status(200).send(result);
    } catch (error) {
      throw mapAuthRouteError(app, error, "Login failed");
    }
  });

  app.post(joinApiV1(apiV1Base, "/auth/onboarding-dashboard-link"), async (request, reply) => {
    if (!hasValidInternalServiceKey(request)) {
      throw app.httpErrors.unauthorized("Invalid internal service credentials");
    }
    try {
      const input = mintOnboardingLinkSchema.parse(request.body);
      const result = await mintOnboardingDashboardLink(app.prisma, input);
      return reply.status(200).send(result);
    } catch (error) {
      throw mapAuthRouteError(app, error, "Unable to create onboarding dashboard link");
    }
  });

  app.post(joinApiV1(apiV1Base, "/auth/onboarding-exchange"), async (request, reply) => {
    const secret = process.env.JWT_SECRET;
    if (!secret) {
      throw app.httpErrors.internalServerError("JWT_SECRET is not configured");
    }
    try {
      const input = exchangeOnboardingCodeSchema.parse(request.body);
      const result = await exchangeOnboardingCode(app.prisma, input.code, secret);
      try {
        await registerSipOnLogin(app.prisma, result.user.organizationId, result.user.id);
      } catch (error) {
        app.log.warn({ error, userId: result.user.id }, "sip registration on onboarding failed");
      }
      return reply.status(200).send(result);
    } catch (error) {
      throw mapAuthRouteError(app, error, "Onboarding exchange failed");
    }
  });

  app.post(joinApiV1(apiV1Base, "/auth/logout"), { preHandler: app.authenticate }, async (request) => {
    const token = request.accessToken;
    if (token) {
      await revokeAuthSession(app.prisma, token);
    }

    // Mark the agent offline so routing stops offering to a logged-out agent
    // and live monitoring reflects the change immediately.
    const organizationId = request.tenantId;
    const userId = request.userId;
    if (organizationId && userId) {
      try {
        await unregisterSipOnLogout(app.prisma, organizationId, userId);
      } catch (error) {
        app.log.warn({ error, userId }, "sip registration on logout failed");
      }

      try {
        const presence = await withOrganizationContext(app.prisma, organizationId, (db) =>
          updateAgentPresence(db, organizationId, userId, {
            state: "offline",
            source: "logout",
          }),
        );
        emitPresenceUpdated(organizationId, presence, userId);

        const released = await withOrganizationContext(app.prisma, organizationId, (db) =>
          releasePendingNonEmailOffersForAgent(db, organizationId, presence.agentId),
        );
        for (const item of released) {
          cancelOfferExpiration(organizationId, item.conversation.id);
          emitConversationRejected(organizationId, item.conversation, userId);
          if (item.transfer) {
            emitTransferExpired(
              organizationId,
              item.transfer,
              userId,
              item.conversation,
            );
          } else if (item.rerouted && item.nextUserId) {
            emitConversationRouted(organizationId, item.conversation, item.nextUserId);
            if (shouldScheduleOfferExpiration(item.conversation)) {
              await scheduleOfferExpiration(app, organizationId, item.conversation.id);
            }
          } else {
            emitConversationQueued(organizationId, item.conversation);
          }
        }
      } catch (error) {
        app.log.warn({ error, userId }, "logout presence cleanup failed");
      }
    }

    return { ok: true };
  });
}
